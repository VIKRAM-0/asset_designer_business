/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Download, RotateCcw, UploadCloud, Info, Camera, X } from 'lucide-react';

// FAST GPU-Accelerated Greyscale
function makeGreyscaleTex(origTex: THREE.Texture) {
  if (!origTex || !origTex.image) return null;
  try {
    const img = origTex.image;
    const w = img.width || img.naturalWidth || img.videoWidth || 512;
    const h = img.height || img.naturalHeight || img.videoHeight || 512;
    
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    
    ctx.filter = 'grayscale(100%) brightness(1.2) contrast(1.1)';
    ctx.drawImage(img, 0, 0, w, h);

    const t = new THREE.CanvasTexture(c);
    t.encoding = origTex.encoding;
    t.wrapS = origTex.wrapS; t.wrapT = origTex.wrapT;
    t.repeat.copy(origTex.repeat); t.offset.copy(origTex.offset);
    if (origTex.flipY !== undefined) t.flipY = origTex.flipY;
    t.anisotropy = origTex.anisotropy;
    if (origTex.center) t.center.copy(origTex.center);
    t.rotation = origTex.rotation;
    t.needsUpdate = true;
    return t;
  } catch (e) {
    console.warn("Could not greyscale texture:", e);
    return null;
  }
}

// Fabric Library from update.html
const BASE_URL = 'https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/';

const fabricLibrary = [
  { name: 'Boucle Fabric', folder: BASE_URL + 'boucle_fabric', defaults: { brightness: 1.0, sheen: 0.0, roughness: 0.7, metalness: 0.0, scale: 3.0, bump: 1.0 } },
  { name: 'Cotton Fabric', folder: BASE_URL + 'cotton_fabric', defaults: { brightness: 1.0, sheen: 0.0, roughness: 0.7, metalness: 0.0, scale: 3.0, bump: 1.0 } },
  { name: 'Curly Fabric', folder: BASE_URL + 'curly_fabric', defaults: { brightness: 1.0, sheen: 0.0, roughness: 0.7, metalness: 0.0, scale: 3.0, bump: 1.0 } },
  { name: 'Dotted Fabric', folder: BASE_URL + 'dotted_fabric', defaults: { brightness: 1.0, sheen: 0.0, roughness: 0.7, metalness: 0.0, scale: 3.0, bump: 1.0 } },
  { name: 'Leather Fabric', folder: BASE_URL + 'leather_fabric', defaults: { brightness: 1.0, sheen: 0.0, roughness: 0.7, metalness: 0.0, scale: 3.0, bump: 1.0 } },
  { name: 'Leather Dotted', folder: BASE_URL + 'leather_dotted_fabric', defaults: { brightness: 1.0, sheen: 0.0, roughness: 0.7, metalness: 0.0, scale: 3.0, bump: 1.0 } },
  { name: 'Line Fabric', folder: BASE_URL + 'line_fabric', defaults: { brightness: 1.0, sheen: 0.0, roughness: 0.7, metalness: 0.0, scale: 3.0, bump: 1.0 } },
  { name: 'Printed Fabric', folder: BASE_URL + 'printted_fabric', defaults: { brightness: 1.0, sheen: 0.0, roughness: 0.7, metalness: 0.0, scale: 3.0, bump: 1.0 } }
];

// Smart Texture Loader (Checks multiple extensions)
const texCache: { [key: string]: THREE.Texture } = {};
const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');

function tryLoadTexture(url: string, isSrgb: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    texLoader.load(
      url,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.encoding = isSrgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
        texCache[url] = tex;
        resolve(tex);
      },
      undefined,
      () => reject(new Error('File missing'))
    );
  });
}

// Automatically loops through possible extensions until it finds the correct one
async function loadTextureWithFallbacks(folder: string, fileName: string, isSrgb: boolean): Promise<{ tex: THREE.Texture | null, url: string | null }> {
  const extensions = ['.webp', '.jpg', '.png', '.jpeg'];
  
  for (let ext of extensions) {
    const url = `${folder}/${fileName}${ext}`;
    
    // Check Cache first
    if (texCache[url]) return { tex: texCache[url], url };
    
    // Try to load
    try {
      const tex = await tryLoadTexture(url, isSrgb);
      return { tex, url };
    } catch (e) {
      // Silently move to the next extension
    }
  }
  
  console.warn(`Could not find texture map for: ${folder}/${fileName}`);
  return { tex: null, url: null };
}

type MeshEntry = {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  matIndex: number;
  origMat: THREE.Material;
  greyMat: THREE.MeshPhysicalMaterial;
  origGreyscaleMap: THREE.Texture | null;
  checked: boolean;
  uvScaleFactor: number;
};

const defaultProperties = {
  roughness: 0.7,
  metalness: 0.0,
  sheen: 0.0,
  texScale: 3.0,
  normScale: 1.0,
  brightness: 1.0
};

export default function App() {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('Processing...');
  const [toast, setToast] = useState('');
  const [hasModel, setHasModel] = useState(false);
  
  const [meshEntries, setMeshEntries] = useState<MeshEntry[]>([]);
  
  const [pbrTextures, setPbrTextures] = useState<{
    map: THREE.Texture | null;
    normalMap: THREE.Texture | null;
    roughnessMap: THREE.Texture | null;
  }>({ map: null, normalMap: null, roughnessMap: null });

  const [texScale, setTexScale] = useState(defaultProperties.texScale);
  const [normScale, setNormScale] = useState(defaultProperties.normScale);
  const [roughness, setRoughness] = useState(defaultProperties.roughness);
  const [metalness, setMetalness] = useState(defaultProperties.metalness);
  const [sheen, setSheen] = useState(defaultProperties.sheen);
  const [brightness, setBrightness] = useState(defaultProperties.brightness);
  
  const [renderedImage, setRenderedImage] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const [fabricThumbnails, setFabricThumbnails] = useState<{ [key: number]: string | null }>({});

  // Three.js refs
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(new THREE.PerspectiveCamera(42, 1, 0.01, 1000));
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const currentModelRef = useRef<THREE.Group | null>(null);
  
  const sphRef = useRef({ theta: 0.4, phi: 1.15, r: 2.2 });
  const tgtRef = useRef(new THREE.Vector3());

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  };

  const camUpdate = useCallback(() => {
    const camera = cameraRef.current;
    const sph = sphRef.current;
    const tgt = tgtRef.current;
    camera.position.set(
      tgt.x + sph.r * Math.sin(sph.phi) * Math.sin(sph.theta),
      tgt.y + sph.r * Math.cos(sph.phi),
      tgt.z + sph.r * Math.sin(sph.phi) * Math.cos(sph.theta)
    );
    camera.lookAt(tgt);
  }, []);

  useEffect(() => {
    if (!viewerRef.current) return;
    
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.physicallyCorrectLights = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
// 1. Match the exact exposure from the business side
    renderer.toneMappingExposure = 1.2; 
    viewerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = sceneRef.current;
    
    // 2. Add the Room Environment for photorealistic PBR reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    // 3. Match the exact simple lighting from the business side
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    const dirLight = new THREE.DirectionalLight(0xfff8f0, 2.5);
    dirLight.position.set(3, 5, 4);
    
    scene.add(ambientLight, dirLight);

    camUpdate();

    let isDrag = false, isRight = false, prevMouse = { x: 0, y: 0 };
    
    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).id === 'drop-input') return;
      isDrag = true;
      isRight = e.button === 2;
      prevMouse = { x: e.clientX, y: e.clientY };
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrag) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      prevMouse = { x: e.clientX, y: e.clientY };
      
      const sph = sphRef.current;
      const tgt = tgtRef.current;
      const camera = cameraRef.current;

      if (isRight) {
        const spd = 0.002 * sph.r;
        const right = new THREE.Vector3();
        right.crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
        tgt.addScaledVector(right, -dx * spd);
        tgt.addScaledVector(camera.up, dy * spd);
      } else {
        sph.theta -= dx * 0.007;
        sph.phi = Math.max(0.1, Math.min(Math.PI - 0.1, sph.phi - dy * 0.007));
      }
      camUpdate();
    };
    
    const handleMouseUp = () => isDrag = false;
    const handleContextMenu = (e: Event) => e.preventDefault();
    const handleWheel = (e: WheelEvent) => {
      sphRef.current.r = Math.max(0.3, Math.min(30, sphRef.current.r + e.deltaY * 0.004));
      camUpdate();
      e.preventDefault();
    };

    const viewerEl = viewerRef.current;
    viewerEl.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    viewerEl.addEventListener('contextmenu', handleContextMenu);
    viewerEl.addEventListener('wheel', handleWheel, { passive: false });

    const resizeObserver = new ResizeObserver(() => {
      if (!viewerEl || !rendererRef.current) return;
      const w = viewerEl.clientWidth;
      const h = viewerEl.clientHeight;
      rendererRef.current.setSize(w, h, false);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    });
    resizeObserver.observe(viewerEl);

    let animationFrameId: number;
    const loop = () => {
      animationFrameId = requestAnimationFrame(loop);
      rendererRef.current?.render(sceneRef.current, cameraRef.current);
    };
    loop();

    const loadInitial = async () => {
      try {
        setLoading(true);
        setLoadingMsg("Loading Default Sofa...");
        const res = await fetch('https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/glbs/sofa_191.glb');
        const arrayBuffer = await res.arrayBuffer();
        onGLBBuffer(arrayBuffer);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    loadInitial();

    return () => {
      viewerEl.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      viewerEl.removeEventListener('contextmenu', handleContextMenu);
      viewerEl.removeEventListener('wheel', handleWheel);
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      if (rendererRef.current) {
        viewerEl.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [camUpdate]);

  // Load fabric thumbnails
  useEffect(() => {
    const loadThumbnails = async () => {
      const thumbnails: { [key: number]: string | null } = {};
      
      for (let i = 0; i < fabricLibrary.length; i++) {
        try {
          const result = await loadTextureWithFallbacks(fabricLibrary[i].folder, 'BaseColor', true);
          thumbnails[i] = result.url;
        } catch (e) {
          thumbnails[i] = null;
        }
      }
      
      setFabricThumbnails(thumbnails);
    };
    
    loadThumbnails();
  }, []);

  const onGLBBuffer = (arrayBuffer: ArrayBuffer) => {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);
    
    loader.parse(arrayBuffer, '', (gltf) => {
      try {
        if (currentModelRef.current) sceneRef.current.remove(currentModelRef.current);
        const currentModel = gltf.scene;
        currentModelRef.current = currentModel;

        const box = new THREE.Box3().setFromObject(currentModel);
        const ctr = box.getCenter(new THREE.Vector3());
        const sz = box.getSize(new THREE.Vector3());
        const sc = 1.6 / Math.max(sz.x, sz.y, sz.z);
        currentModel.scale.setScalar(sc);
        currentModel.position.sub(ctr.multiplyScalar(sc));
        currentModel.updateMatrixWorld(true);
        sceneRef.current.add(currentModel);

        const worldBox = new THREE.Box3().setFromObject(currentModel);
        const worldCenter = worldBox.getCenter(new THREE.Vector3());
        const worldSize = worldBox.getSize(new THREE.Vector3());

        const newEntries: MeshEntry[] = [];
        let meshCounter = 0;

        currentModel.traverse((child) => {
          if (!(child as THREE.Mesh).isMesh) return;
          const mesh = child as THREE.Mesh;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

          materials.forEach((origMat: any, index) => {
            const greyMat = new THREE.MeshPhysicalMaterial();
            
            if (origMat.color) greyMat.color.copy(origMat.color);
            greyMat.roughness = origMat.roughness !== undefined ? origMat.roughness : 0.7;
            greyMat.metalness = origMat.metalness !== undefined ? origMat.metalness : 0.0;
            
            if (origMat.map) greyMat.map = origMat.map;
            if (origMat.normalMap) {
                greyMat.normalMap = origMat.normalMap;
                if (origMat.normalScale) greyMat.normalScale.copy(origMat.normalScale);
            }
            if (origMat.roughnessMap) greyMat.roughnessMap = origMat.roughnessMap;
            if (origMat.metalnessMap) greyMat.metalnessMap = origMat.metalnessMap;
            
            greyMat.side = origMat.side !== undefined ? origMat.side : THREE.FrontSide;
            greyMat.transparent = origMat.transparent || false;
            greyMat.opacity = origMat.opacity !== undefined ? origMat.opacity : 1;
            greyMat.alphaTest = origMat.alphaTest !== undefined ? origMat.alphaTest : 0;
            
            greyMat.sheen = new THREE.Color(0x000000); 
            greyMat.sheenRoughness = 0.5;
            
            let origGreyscaleMap = null;
            if (origMat.map) {
              origGreyscaleMap = makeGreyscaleTex(origMat.map);
              if (origGreyscaleMap) greyMat.map = origGreyscaleMap;
            }

            // Don't set default color - fabrics will handle this
            greyMat.needsUpdate = true;

            let rawName = origMat.name || mesh.name || '';
            let cleanName = '';
            const nl = rawName.toLowerCase();
            
            if (nl.includes('cushion') || nl.includes('seat')) cleanName = 'Seat Cushion';
            else if (nl.includes('leg') || nl.includes('foot') || nl.includes('base')) cleanName = 'Legs / Base';
            else if (nl.includes('arm')) cleanName = 'Armrest';
            else if (nl.includes('back')) cleanName = 'Backrest';
            else if (nl.includes('wood')) cleanName = 'Wood Parts';
            else if (nl.includes('metal')) cleanName = 'Metal Parts';
            else if (nl.includes('pillow')) cleanName = 'Pillows';
            else if (nl.includes('fabric')) cleanName = 'Fabric';
            else {
                const isGarbage = rawName.length > 20 && (rawName.includes('-') || /[0-9a-f]{8}/i.test(rawName));
                if (isGarbage || !rawName) {
                    const meshBox = new THREE.Box3().setFromObject(mesh);
                    const meshCenter = meshBox.getCenter(new THREE.Vector3());
                    
                    if (meshCenter.y < worldCenter.y - worldSize.y * 0.25) cleanName = 'Legs / Base';
                    else if (meshCenter.z < worldCenter.z - worldSize.z * 0.2) cleanName = 'Backrest';
                    else if (Math.abs(meshCenter.x - worldCenter.x) > worldSize.x * 0.3) cleanName = 'Armrests';
                    else cleanName = `Body Part ${meshCounter + 1}`;
                } else {
                    cleanName = rawName.replace(/[-_]/g, ' ').replace(/([A-Z])/g, ' $1').trim();
                    cleanName = cleanName.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                    cleanName = cleanName.replace(/[0-9]+/g, '').replace(/\.gltf|\.glb|\.obj/g, '').trim();
                    if (!cleanName || cleanName.length < 2) cleanName = `Part ${meshCounter + 1}`;
                }
            }

            mesh.geometry.computeBoundingBox();
            const size = new THREE.Vector3();
            if (mesh.geometry.boundingBox) {
                mesh.geometry.boundingBox.getSize(size);
            }
            const maxDim = Math.max(size.x, size.y, size.z);
            const uvScaleFactor = maxDim > 0 ? maxDim : 1;

            newEntries.push({
              id: `mesh-${meshCounter}-${index}`,
              name: cleanName,
              mesh,
              matIndex: Array.isArray(mesh.material) ? index : -1,
              origMat,
              greyMat,
              origGreyscaleMap, 
              checked: false,
              uvScaleFactor
            });
            meshCounter++;
          });
        });

        setMeshEntries(newEntries);
        setHasModel(true);
        
        sphRef.current = { theta: 0.4, phi: 1.15, r: 2.2 };
        tgtRef.current.set(0, 0, 0);
        camUpdate();
        
        setRoughness(defaultProperties.roughness);
        setMetalness(defaultProperties.metalness);
        setSheen(defaultProperties.sheen);

      } catch (processError) {
        console.error("Error processing GLB materials:", processError);
        showToast("Model loaded but styling failed.");
      } finally {
        setLoading(false);
      }
    }, (err) => {
      console.error(err);
      setLoading(false);
      showToast('Failed to parse GLB: ' + ((err as Error).message || err));
    });
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    setLoading(true);
    setLoadingMsg('Processing...');
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) onGLBBuffer(e.target.result as ArrayBuffer);
    };
    reader.onerror = () => {
      setLoading(false);
      showToast('Failed to read file');
    };
    reader.readAsArrayBuffer(f);
  };

  const loadPBRMap = (file: File | null, mapType: 'map' | 'normalMap' | 'roughnessMap') => {
    if (!file) return;
    setLoading(true);
    setLoadingMsg('Loading Texture...');
    const url = URL.createObjectURL(file);

    new THREE.TextureLoader().load(url, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.flipY = false;

      if (mapType === 'map') texture.encoding = THREE.sRGBEncoding;
      else texture.encoding = THREE.LinearEncoding;

      setPbrTextures(prev => ({ ...prev, [mapType]: texture }));

      let applied = 0;

      setMeshEntries(prev => {
        const next = [...prev];
        next.forEach(entry => {
          if (entry.checked) {
            const clonedTex = texture.clone();
            const finalScale = texScale * entry.uvScaleFactor;
            clonedTex.repeat.set(finalScale, finalScale);
            clonedTex.needsUpdate = true;
            
            entry.greyMat[mapType] = clonedTex;
            if (mapType === 'map') entry.greyMat.color.setHex(0xffffff); 
            if (mapType === 'normalMap') entry.greyMat.normalScale = new THREE.Vector2(normScale, normScale);
            entry.greyMat.needsUpdate = true;
            applied++;
          }
        });
        return next;
      });

      if (applied === 0) showToast("Check a part in the list first!");
      setLoading(false);
    });
  };

  const toggleMeshCheck = (id: string, checked: boolean) => {
    setMeshEntries(prev => prev.map(entry => {
      if (entry.id !== id) return entry;
      
      const newEntry = { ...entry, checked };
      
      if (newEntry.matIndex === -1) {
        newEntry.mesh.material = checked ? newEntry.greyMat : newEntry.origMat;
      } else {
        const matArray = Array.isArray(newEntry.mesh.material) ? [...newEntry.mesh.material] : [];
        if (matArray.length > 0) {
          matArray[newEntry.matIndex] = checked ? newEntry.greyMat : newEntry.origMat;
          newEntry.mesh.material = matArray;
        }
      }

      if (checked) {
        if (pbrTextures.map) {
          const t = pbrTextures.map.clone();
          t.repeat.set(texScale * newEntry.uvScaleFactor, texScale * newEntry.uvScaleFactor);
          t.needsUpdate = true;
          newEntry.greyMat.map = t;
        } else {
          newEntry.greyMat.map = newEntry.origGreyscaleMap;
        }
        
        if (pbrTextures.normalMap) {
          const t = pbrTextures.normalMap.clone();
          t.repeat.set(texScale * newEntry.uvScaleFactor, texScale * newEntry.uvScaleFactor);
          t.needsUpdate = true;
          newEntry.greyMat.normalMap = t;
          newEntry.greyMat.normalScale = new THREE.Vector2(normScale, normScale);
        } else {
          newEntry.greyMat.normalMap = null;
        }
        
        if (pbrTextures.roughnessMap) {
          const t = pbrTextures.roughnessMap.clone();
          t.repeat.set(texScale * newEntry.uvScaleFactor, texScale * newEntry.uvScaleFactor);
          t.needsUpdate = true;
          newEntry.greyMat.roughnessMap = t;
        } else {
          newEntry.greyMat.roughnessMap = null;
          newEntry.greyMat.roughness = roughness;
        }

        if (!pbrTextures.map) {
           newEntry.greyMat.color.setHex(0xffffff).multiplyScalar(brightness);
        } else {
           newEntry.greyMat.color.setHex(0xffffff).multiplyScalar(brightness);
        }
        
        newEntry.greyMat.needsUpdate = true;
      }
      
      return newEntry;
    }));
  };

  // Apply Fabric with Smart Auto-Discovery
  const applyFabric = async (idx: number) => {
    const fabric = fabricLibrary[idx];
    const hasChecked = meshEntries.some(e => e.checked);
    
    if (!hasChecked) {
      showToast("Select a part in the right panel first!");
      return;
    }

    setLoading(true);
    setLoadingMsg('Applying Textures...');
    
    try {
      // Automatically find the correct extension for each map type
      const [diffRes, normRes, roughRes] = await Promise.all([
        loadTextureWithFallbacks(fabric.folder, 'BaseColor', true),
        loadTextureWithFallbacks(fabric.folder, 'Normal', false),
        loadTextureWithFallbacks(fabric.folder, 'Roughness', false)
      ]);

      const diffTex = diffRes.tex;
      const normTex = normRes.tex;
      const roughTex = roughRes.tex;

      // Pull defaults defined in fabricLibrary
      const bright = fabric.defaults.brightness !== undefined ? fabric.defaults.brightness : 1.0;
      const shn = fabric.defaults.sheen !== undefined ? fabric.defaults.sheen : 0.0;
      const rgh = fabric.defaults.roughness !== undefined ? fabric.defaults.roughness : 0.7;
      const mtl = fabric.defaults.metalness !== undefined ? fabric.defaults.metalness : 0.0;
      const scl = fabric.defaults.scale !== undefined ? fabric.defaults.scale : 3.0;
      const bmp = fabric.defaults.bump !== undefined ? fabric.defaults.bump : 1.0;

      // Update UI Sliders to Preset Defaults
      setBrightness(bright);
      setSheen(shn);
      setRoughness(rgh);
      setMetalness(mtl);
      setTexScale(scl);
      setNormScale(bmp);

      // Apply textures to scale
      [diffTex, normTex, roughTex].forEach(t => { if (t) t.repeat.set(scl, scl); });

      // Inject Textures into Meshes
      setMeshEntries(prev => {
        const next = [...prev];
        next.forEach(entry => {
          if (entry.checked) {
            const mat = entry.greyMat;
            mat.map = diffTex;
            mat.normalMap = normTex;
            mat.roughnessMap = roughTex;
            
            // Brightness Multiplier logic using material color tinting
            mat.color.setRGB(bright, bright, bright);
            mat.normalScale.set(bmp, bmp);
            
            const s = shn * 255;
            mat.sheen = new THREE.Color(`rgb(${Math.floor(s)},${Math.floor(s)},${Math.floor(s)})`);
            mat.roughness = rgh;
            mat.metalness = mtl;
            
            mat.needsUpdate = true;
          }
        });
        return next;
      });

    } catch (e) {
      console.error("Texture Load Exception:", e);
      showToast("Error retrieving texture maps.");
    } finally {
      setLoading(false);
    }
  };

  const updateBrightness = (val: number) => {
    setBrightness(val);
    setMeshEntries(prev => {
      const next = [...prev];
      next.forEach(entry => {
        if (!entry.checked) return;
        const baseColor = new THREE.Color(pbrTextures.map ? 0xffffff : 0xffffff);
        baseColor.multiplyScalar(val);
        entry.greyMat.color.copy(baseColor);
        entry.greyMat.needsUpdate = true;
      });
      return next;
    });
  };

  const applyPropToChecked = (prop: 'roughness' | 'metalness' | 'sheen', val: number) => {
    if (prop === 'roughness') setRoughness(val);
    if (prop === 'metalness') setMetalness(val);
    if (prop === 'sheen') setSheen(val);

    setMeshEntries(prev => {
      const next = [...prev];
      next.forEach(entry => {
        if (!entry.checked) return;
        if (prop === 'sheen') {
            const c = Math.floor(val * 255);
            entry.greyMat.sheen = new THREE.Color(`rgb(${c},${c},${c})`);
        } else {
            (entry.greyMat as any)[prop] = val;
        }
        entry.greyMat.needsUpdate = true;
      });
      return next;
    });
  };

  const updateTextureScale = (val: number) => {
    setTexScale(val);
    setMeshEntries(prev => {
      const next = [...prev];
      next.forEach(entry => {
        if (!entry.checked) return;
        const finalScale = val * entry.uvScaleFactor;
        if (entry.greyMat.map && entry.greyMat.map !== entry.origGreyscaleMap) {
           entry.greyMat.map.repeat.set(finalScale, finalScale);
        }
        if (entry.greyMat.normalMap) {
           entry.greyMat.normalMap.repeat.set(finalScale, finalScale);
        }
        if (entry.greyMat.roughnessMap) {
           entry.greyMat.roughnessMap.repeat.set(finalScale, finalScale);
        }
        entry.greyMat.needsUpdate = true;
      });
      return next;
    });
  };

  const updateNormalScale = (val: number) => {
    setNormScale(val);
    setMeshEntries(prev => {
      const next = [...prev];
      next.forEach(entry => {
        if (entry.checked && entry.greyMat.normalMap) {
          entry.greyMat.normalScale = new THREE.Vector2(val, val);
          entry.greyMat.needsUpdate = true;
        }
      });
      return next;
    });
  };

  const resetProperties = () => {
    setRoughness(defaultProperties.roughness);
    setMetalness(defaultProperties.metalness);
    setSheen(defaultProperties.sheen);
    setTexScale(defaultProperties.texScale);
    setNormScale(defaultProperties.normScale);
    setBrightness(defaultProperties.brightness);
    
    setPbrTextures({ map: null, normalMap: null, roughnessMap: null });

    setMeshEntries(prev => {
      const next = [...prev];
      next.forEach(entry => {
        if (!entry.checked) return;
        
        entry.greyMat.roughness = defaultProperties.roughness;
        entry.greyMat.metalness = defaultProperties.metalness;
        entry.greyMat.sheen = new THREE.Color(0x000000);
        
        entry.greyMat.map = entry.origGreyscaleMap;
        entry.greyMat.normalMap = null;
        entry.greyMat.roughnessMap = null;
        
        entry.greyMat.color.setHex(0xffffff).multiplyScalar(defaultProperties.brightness);
        entry.greyMat.needsUpdate = true;
      });
      return next;
    });
    
    showToast("Properties reset to normal");
  };

  const renderScene = async () => {
    if (!rendererRef.current || !hasModel) {
      showToast("Load a model first!");
      return;
    }

    try {
      setIsRendering(true);
      setLoadingMsg("Generating AI Render...");
      setLoading(true);

      // Render the scene to the canvas before capturing
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      const canvas = rendererRef.current.domElement;
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.split(',')[1];

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageData: base64Data }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        console.error('API error:', response.status, errorBody);
        showToast('Error generating render.');
        return;
      }

      const result = await response.json();
      if (result.imageUrl) {
        setRenderedImage(result.imageUrl);
      } else {
        showToast('Failed to generate image.');
      }
    } catch (error) {
      console.error('Render error:', error);
      showToast('Error generating render.');
    } finally {
      setIsRendering(false);
      setLoading(false);
    }
  };

  const exportGLB = () => {
    if (!currentModelRef.current) {
      showToast("Load a model first!");
      return;
    }
    
    setLoading(true);
    setLoadingMsg("Exporting...");

    const exporter = new GLTFExporter();
    exporter.parse(
      currentModelRef.current,
      (gltf) => {
        const blob = gltf instanceof ArrayBuffer 
          ? new Blob([gltf], { type: 'application/octet-stream' })
          : new Blob([JSON.stringify(gltf)], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = url;
        link.download = gltf instanceof ArrayBuffer ? 'customized_model.glb' : 'customized_model.gltf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setLoading(false);
        showToast("Download started!");
      },
      (error) => {
        console.error(error);
        setLoading(false);
        showToast("Export failed!");
      },
      { binary: true } 
    );
  };

  return (
    <div className="flex flex-col h-screen bg-white text-gray-900 overflow-hidden">
      <header className="flex items-center justify-between px-8 py-5 border-b border-gray-200 shrink-0 bg-white">
        <div className="flex items-baseline gap-4">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Configurator</h1>
          <span className="text-xs font-medium tracking-wide text-gray-400 uppercase">Pro Studio Engine</span>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-5 py-2.5 rounded text-xs font-semibold cursor-pointer transition-colors shadow-sm">
            Upload GLB
            <input type="file" accept=".glb,.gltf" onChange={(e) => handleFile(e.target.files?.[0] || null)} className="hidden" />
          </label>
          <button 
            onClick={resetProperties}
            className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-5 py-2.5 rounded text-xs font-semibold transition-colors shadow-sm"
          >
            <RotateCcw size={14} /> Restart
          </button>
          <button 
            onClick={renderScene} 
            disabled={isRendering}
            className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-5 py-2.5 rounded text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
          >
            <Camera size={14} /> {isRendering ? 'Rendering...' : 'Render'}
          </button>
          <button 
            onClick={exportGLB} 
            className="flex items-center gap-2 bg-black hover:bg-gray-800 text-white px-6 py-2.5 rounded text-xs font-semibold transition-colors shadow-md"
          >
            <Download size={14} /> Save Fabric
          </button>
        </div>
      </header>
      
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Panel: Fabric & Color */}
        <div className="w-80 border-r border-gray-200 flex flex-col overflow-y-auto shrink-0 bg-white z-30">
          
          {/* 2. PBR Textures */}
          <div className="p-6 border-b border-gray-100">
            <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-5">Fabric Library</div>
            
            <div className="space-y-4 mb-6">
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[10px] font-semibold text-gray-500 block uppercase tracking-wider">Base Color (Diffuse)</span>
                  <div className="relative group flex items-center">
                    <Info size={12} className="text-gray-400 cursor-help" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-900 text-white text-[10px] rounded shadow-lg z-50 normal-case tracking-normal font-normal text-center">
                      The main color or pattern of the fabric. It defines how the material looks under neutral light.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
                <label className={`flex justify-between items-center w-full px-4 py-3 text-left bg-gray-50 border rounded text-xs font-medium cursor-pointer transition-colors ${pbrTextures.map ? 'border-black text-black' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  Upload Image
                  {pbrTextures.map && <span className="text-black text-[10px]">Loaded ✔</span>}
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => loadPBRMap(e.target.files?.[0] || null, 'map')} />
                </label>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[10px] font-semibold text-gray-500 block uppercase tracking-wider">Normal Map (GL)</span>
                  <div className="relative group flex items-center">
                    <Info size={12} className="text-gray-400 cursor-help" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-900 text-white text-[10px] rounded shadow-lg z-50 normal-case tracking-normal font-normal text-center">
                      Adds physical bumps, wrinkles, and texture depth without changing the 3D shape.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
                <label className={`flex justify-between items-center w-full px-4 py-3 text-left bg-gray-50 border rounded text-xs font-medium cursor-pointer transition-colors ${pbrTextures.normalMap ? 'border-black text-black' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  Upload Image
                  {pbrTextures.normalMap && <span className="text-black text-[10px]">Loaded ✔</span>}
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => loadPBRMap(e.target.files?.[0] || null, 'normalMap')} />
                </label>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[10px] font-semibold text-gray-500 block uppercase tracking-wider">Roughness Map</span>
                  <div className="relative group flex items-center">
                    <Info size={12} className="text-gray-400 cursor-help" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-900 text-white text-[10px] rounded shadow-lg z-50 normal-case tracking-normal font-normal text-center">
                      Controls how shiny or matte different parts of the fabric are. White is matte, black is shiny.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
                <label className={`flex justify-between items-center w-full px-4 py-3 text-left bg-gray-50 border rounded text-xs font-medium cursor-pointer transition-colors ${pbrTextures.roughnessMap ? 'border-black text-black' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  Upload Image
                  {pbrTextures.roughnessMap && <span className="text-black text-[10px]">Loaded ✔</span>}
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => loadPBRMap(e.target.files?.[0] || null, 'roughnessMap')} />
                </label>
              </div>
            </div>
          </div>

          {/* 3. Fabric Selection */}
          <div className="p-6">
            <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-5">Fabric Selection</div>
            <div className="grid grid-cols-2 gap-3">
              {fabricLibrary.map((fab, idx) => (
                <div key={idx} className="flex flex-col items-center gap-2">
                  <div
                    className="w-full aspect-square cursor-pointer border-2 border-transparent hover:border-gray-300 transition-all bg-gray-50 flex items-center justify-center overflow-hidden"
                    onClick={() => applyFabric(idx)}
                  >
                    {fabricThumbnails[idx] ? (
                      <img 
                        src={fabricThumbnails[idx]!} 
                        alt={fab.name} 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-[10px] text-gray-500 text-center px-2">{fab.name}</div>
                    )}
                  </div>
                  <span className="text-[10px] font-medium text-gray-500 truncate w-full text-center">{fab.name}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
        
        {/* Center: Viewer */}
        <div 
          className="flex-1 relative bg-[#fafafa] cursor-grab active:cursor-grabbing"
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.outline = '2px solid #000'; e.currentTarget.style.outlineOffset = '-4px'; }}
          onDragLeave={(e) => { e.currentTarget.style.outline = 'none'; }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.style.outline = 'none'; const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        >
          <div ref={viewerRef} className="absolute inset-0" />
          
          {!hasModel && (
            <>
              <input type="file" id="drop-input" accept=".glb,.gltf" onChange={(e) => handleFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
                <div className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-full flex items-center justify-center bg-white">
                  <UploadCloud size={32} className="text-gray-400" strokeWidth={1.5} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-600 mb-1">Drop your GLB file here</p>
                  <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">or click to browse</p>
                </div>
              </div>
            </>
          )}

          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/80 backdrop-blur-sm z-20">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
              <p className="text-[10px] font-bold text-gray-500 tracking-widest uppercase">{loadingMsg}</p>
            </div>
          )}

          {toast && (
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded shadow-lg text-xs font-medium whitespace-nowrap z-[99] transition-opacity">
              {toast}
            </div>
          )}

          {hasModel && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-8 px-8 py-4 bg-white border border-gray-100 rounded-sm shadow-sm pointer-events-none">
              <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Drag · Rotate</span>
              <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Scroll · Zoom</span>
              <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Right-drag · Pan</span>
            </div>
          )}
        </div>
        
        {/* Right Panel: Properties */}
        <div className="w-80 border-l border-gray-200 flex flex-col overflow-y-auto shrink-0 bg-white z-30">
          
          {/* 1. Select Parts */}
          <div className="p-6 border-b border-gray-100 flex-1">
            <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-5">1. Select Parts</div>
            <div className="flex flex-col gap-2">
              {!hasModel && <div className="text-xs text-gray-400 italic">Load a GLB first</div>}
              {meshEntries.map(entry => (
                <label key={entry.id} className={`flex items-center gap-3 px-4 py-3 border rounded cursor-pointer transition-colors ${entry.checked ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input 
                    type="checkbox" 
                    checked={entry.checked} 
                    onChange={(e) => toggleMeshCheck(entry.id, e.target.checked)}
                    className="w-4 h-4 accent-black cursor-pointer"
                  />
                  <span className={`text-sm font-medium ${entry.checked ? 'text-black' : 'text-gray-600'}`}>{entry.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="p-6 bg-gray-50/50">
            <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-6">2. Material Adjustments</div>
            
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-gray-600 w-20">Brightness</label>
                <input type="range" min="0" max="2" step="0.05" value={brightness} onChange={(e) => updateBrightness(parseFloat(e.target.value))} className="flex-1 h-1 bg-gray-200 rounded appearance-none cursor-pointer accent-black" />
                <span className="text-xs font-medium text-gray-900 w-8 text-right tabular-nums">{brightness.toFixed(2)}</span>
              </div>

              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-gray-600 w-20">Roughness</label>
                <input type="range" min="0" max="1" step="0.01" value={roughness} onChange={(e) => applyPropToChecked('roughness', parseFloat(e.target.value))} className="flex-1 h-1 bg-gray-200 rounded appearance-none cursor-pointer accent-black" />
                <span className="text-xs font-medium text-gray-900 w-8 text-right tabular-nums">{roughness.toFixed(2)}</span>
              </div>

              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-gray-600 w-20">Metalness</label>
                <input type="range" min="0" max="1" step="0.01" value={metalness} onChange={(e) => applyPropToChecked('metalness', parseFloat(e.target.value))} className="flex-1 h-1 bg-gray-200 rounded appearance-none cursor-pointer accent-black" />
                <span className="text-xs font-medium text-gray-900 w-8 text-right tabular-nums">{metalness.toFixed(2)}</span>
              </div>

              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-gray-600 w-20">Fabric Fuzz</label>
                <input type="range" min="0" max="1" step="0.01" value={sheen} onChange={(e) => applyPropToChecked('sheen', parseFloat(e.target.value))} className="flex-1 h-1 bg-gray-200 rounded appearance-none cursor-pointer accent-black" />
                <span className="text-xs font-medium text-gray-900 w-8 text-right tabular-nums">{sheen.toFixed(2)}</span>
              </div>

              <div className="h-px bg-gray-200 w-full my-2"></div>

              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-gray-600 w-20">Pattern Scale</label>
                <input type="range" min="0.2" max="10" step="0.1" value={texScale} onChange={(e) => updateTextureScale(parseFloat(e.target.value))} className="flex-1 h-1 bg-gray-200 rounded appearance-none cursor-pointer accent-black" />
                <span className="text-xs font-medium text-gray-900 w-8 text-right tabular-nums">{texScale.toFixed(1)}</span>
              </div>

              <div className="flex items-center gap-4">
                <label className="text-xs font-medium text-gray-600 w-20">Bump Strength</label>
                <input type="range" min="0" max="3" step="0.1" value={normScale} onChange={(e) => updateNormalScale(parseFloat(e.target.value))} className="flex-1 h-1 bg-gray-200 rounded appearance-none cursor-pointer accent-black" />
                <span className="text-xs font-medium text-gray-900 w-8 text-right tabular-nums">{normScale.toFixed(1)}</span>
              </div>
            </div>
          </div>

        </div>

      </div>

      {renderedImage && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-8 backdrop-blur-sm">
          <div className="bg-white rounded-lg overflow-hidden shadow-2xl max-w-4xl w-full flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900 tracking-tight">AI Render Result</h2>
              <button onClick={() => setRenderedImage(null)} className="text-gray-500 hover:text-black transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 bg-gray-50 flex justify-center items-center">
              <img src={renderedImage} alt="AI Render" className="max-h-[70vh] object-contain rounded shadow-sm" />
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end">
              <a 
                href={renderedImage} 
                download="ai_render.png"
                className="flex items-center gap-2 bg-black hover:bg-gray-800 text-white px-6 py-2.5 rounded text-xs font-semibold transition-colors shadow-md"
              >
                <Download size={14} /> Download Image
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

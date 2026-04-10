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
import { Download, RotateCcw, UploadCloud, Info, Camera, X, Check } from 'lucide-react';

// Predefined fabric type presets (Normal + Roughness maps only)
const FABRIC_PRESETS = [
  {
    id: 'cotton',
    label: 'Cotton',
    normalUrl: 'https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/cotton_fabric/Normal.webp',
    roughnessUrl: 'https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/cotton_fabric/Roughness.webp',
    roughness: 0.75,
    sheen: 0.1,
  },
  {
    id: 'leather',
    label: 'Leather',
    normalUrl: 'https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/leather_fabric/Normal.webp',
    roughnessUrl: 'https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/leather_fabric/Roughness.webp',
    roughness: 0.45,
    sheen: 0.0,
  },
  {
    id: 'velvet',
    label: 'Velvet',
    normalUrl: 'https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/velvet_fabric/Normal.webp',
    roughnessUrl: 'https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/velvet_fabric/Roughness.jpg',
    roughness: 0.85,
    sheen: 0.6,
  },
];

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
  const [baseColorHex, setBaseColorHex] = useState('#ffffff');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  type PolyFabricVariant = { key: string; label: string; diffUrl: string; thumb?: string };
  type PolyFabric = { id: string; name: string; thumb: string; variants?: PolyFabricVariant[] };
  const [polyFabrics, setPolyFabrics] = useState<PolyFabric[]>([]);
  const [polyLoading, setPolyLoading] = useState(false);
  const [selectedPolyFabric, setSelectedPolyFabric] = useState<string | null>(null);
  const [fabricTab, setFabricTab] = useState<'custom' | 'polyhaven'>('custom');
  const [activeFabricName, setActiveFabricName] = useState<string>(''); // tracks the last applied fabric label

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

  // Load Polyhaven fabric textures — validate thumbnails before showing
  useEffect(() => {
    const fetchPolyFabrics = async () => {
      setPolyLoading(true);
      try {
        const res = await fetch('https://api.polyhaven.com/assets?t=textures&c=fabric', {
          headers: { 'User-Agent': 'FurnitureConfigurator/1.0' }
        });
        const data = await res.json();
        const candidates: PolyFabric[] = Object.entries(data).map(([id, info]: [string, any]) => ({
          id,
          name: info.name || id.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=128&height=128`,
        }));

        // Validate thumbnails in parallel — only show fabrics whose image loads
        const checkThumb = (url: string): Promise<boolean> =>
          new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
          });

        // Check in batches of 20 to avoid hammering CDN
        const valid: PolyFabric[] = [];
        for (let i = 0; i < candidates.length; i += 20) {
          const batch = candidates.slice(i, i + 20);
          const results = await Promise.all(batch.map(f => checkThumb(f.thumb)));
          batch.forEach((f, j) => { if (results[j]) valid.push(f); });
          setPolyFabrics([...valid]); // stream in as we validate
        }
      } catch (e) {
        console.warn('Polyhaven API unavailable');
      } finally {
        setPolyLoading(false);
      }
    };
    fetchPolyFabrics();
  }, []);

  const [polyVariantModal, setPolyVariantModal] = useState<{ fabric: PolyFabric; files: any } | null>(null);

  // Colour variant key names used by Polyhaven for multi-colour assets
  const POLY_DIFF_KEYS = ['Diffuse', 'diff', 'Color', 'col1', 'col2', 'col3', 'coll1', 'coll2', 'coll3'];
  const POLY_NORM_KEYS = ['nor_gl', 'Normal', 'nor_dx', 'nor', 'Nor_GL', 'NormalGL'];
  const POLY_ROUGH_KEYS = ['Rough', 'rough', 'Roughness', 'roughness'];

  const pickUrl = (files: any, keys: string[]): string | null => {
    // Normalise all file keys to lowercase-no-space for comparison
    const normalise = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
    const fileKeys = Object.keys(files);
    for (const key of keys) {
      // 1. Exact match first
      if (files[key]) {
        const mapData = files[key];
        const url = mapData?.['1k']?.jpg?.url || mapData?.['2k']?.jpg?.url || null;
        if (url) return url;
      }
      // 2. Case-insensitive + ignore spaces/underscores match
      const normKey = normalise(key);
      const matched = fileKeys.find(k => normalise(k) === normKey);
      if (matched && files[matched]) {
        const url = files[matched]?.['1k']?.jpg?.url || files[matched]?.['2k']?.jpg?.url || null;
        if (url) return url;
      }
    }
    return null;
  };

  // Returns all diffuse colour variant entries found in a files object
  const getColourVariants = (files: any, fabricId: string): PolyFabricVariant[] => {
    const variants: PolyFabricVariant[] = [];
    const normalise = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');

    // Patterns that indicate a colour/diffuse map (case-insensitive, space-tolerant)
    const isDiffuseKey = (k: string): boolean => {
      const n = normalise(k);
      return (
        n === 'diffuse' || n === 'diff' || n === 'color' || n === 'colour' ||
        /^col\d+$/.test(n) ||    // col1, col2, col03 etc.
        /^coll\d+$/.test(n)      // coll1, coll2 etc.
      );
    };

    for (const key of Object.keys(files)) {
      if (!isDiffuseKey(key)) continue;
      const mapData = files[key];
      const url = mapData?.['1k']?.jpg?.url || mapData?.['2k']?.jpg?.url;
      if (!url) continue;

      // Build a clean human label from the raw key
      const n = normalise(key);
      let label: string;
      if (n === 'diffuse' || n === 'diff' || n === 'color' || n === 'colour') {
        label = 'Default';
      } else {
        // Extract trailing digits: "col1"→"1", "coll03"→"03", "col 2"→"2"
        const num = n.replace(/^coll?/, '');
        label = `Colour ${parseInt(num, 10)}`; // parseInt strips leading zero: "03"→3
      }
      variants.push({ key, label, diffUrl: url });
    }

    // Sort by label so Default first, then Colour 1, 2, 3 ...
    variants.sort((a, b) => {
      if (a.label === 'Default') return -1;
      if (b.label === 'Default') return 1;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });

    return variants;
  };

  const applyPolyFabric = async (fabric: PolyFabric, variantDiffUrl?: string) => {
    const hasChecked = meshEntries.some(e => e.checked);
    if (!hasChecked) { showToast('Select a part first!'); return; }

    setSelectedPolyFabric(fabric.id);
    setLoading(true);
    setLoadingMsg('Loading Polyhaven textures...');

    try {
      const filesRes = await fetch(`https://api.polyhaven.com/files/${fabric.id}`, {
        headers: { 'User-Agent': 'FurnitureConfigurator/1.0' }
      });
      const files = await filesRes.json();

      // Detect colour variants
      const variants = getColourVariants(files, fabric.id);
      const hasVariants = variants.length > 1;

      // If multi-variant and no specific variant chosen yet, show picker modal
      if (hasVariants && !variantDiffUrl) {
        setPolyVariantModal({ fabric, files });
        setLoading(false);
        return;
      }

      // Resolve diffuse URL: use chosen variant or first available
      const diffUrl = variantDiffUrl || pickUrl(files, POLY_DIFF_KEYS);
      const normUrl = pickUrl(files, POLY_NORM_KEYS);
      const roughUrl = pickUrl(files, POLY_ROUGH_KEYS);

      const loadTex = (url: string, srgb: boolean): Promise<THREE.Texture> =>
        new Promise((resolve, reject) => {
          new THREE.TextureLoader().load(url, (t) => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
            t.flipY = false;
            resolve(t);
          }, undefined, reject);
        });

      const [diffTex, normTex, roughTex] = await Promise.all([
        diffUrl ? loadTex(diffUrl, true).catch(() => null) : Promise.resolve(null),
        normUrl ? loadTex(normUrl, false).catch(() => null) : Promise.resolve(null),
        roughUrl ? loadTex(roughUrl, false).catch(() => null) : Promise.resolve(null),
      ]);

      setPbrTextures({ map: diffTex, normalMap: normTex, roughnessMap: roughTex });
      setSelectedPreset(null);
      setPolyVariantModal(null);

      setMeshEntries(prev => {
        const next = [...prev];
        next.forEach(entry => {
          if (!entry.checked) return;
          const mat = entry.greyMat;
          if (diffTex) {
            const dt = diffTex.clone();
            dt.repeat.set(texScale, texScale);
            dt.needsUpdate = true;
            mat.map = dt;
            mat.color.setRGB(brightness, brightness, brightness);
          }
          if (normTex) {
            const nt = normTex.clone();
            nt.repeat.set(texScale, texScale);
            nt.needsUpdate = true;
            mat.normalMap = nt;
            mat.normalScale.set(normScale, normScale);
          }
          if (roughTex) {
            const rt = roughTex.clone();
            rt.repeat.set(texScale, texScale);
            rt.needsUpdate = true;
            mat.roughnessMap = rt;
          }
          mat.needsUpdate = true;
        });
        return next;
      });

      showToast(`${fabric.name} applied!`);
      setActiveFabricName(fabric.name);
    } catch (e) {
      console.error(e);
      showToast('Failed to load Polyhaven texture');
    } finally {
      setLoading(false);
    }
  };


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

          // CRITICAL: Always normalize to a material array so each slot
          // can be swapped independently without touching sibling entries.
          if (!Array.isArray(mesh.material)) {
            mesh.material = [mesh.material];
            // When converting to array, Three.js needs at least one geometry group
            // covering the whole mesh, otherwise nothing renders.
            if (mesh.geometry.groups.length === 0) {
              const count = mesh.geometry.index
                ? mesh.geometry.index.count
                : mesh.geometry.attributes.position.count;
              mesh.geometry.addGroup(0, count, 0);
            }
          }
          const materials = mesh.material as THREE.Material[];

          materials.forEach((origMat: any, index) => {
            const greyMat = new THREE.MeshPhysicalMaterial({});
            
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
            (greyMat as any).sheenRoughness = 0.5;
            
            let origGreyscaleMap = null;
            if (origMat.map) {
              origGreyscaleMap = makeGreyscaleTex(origMat.map);
              if (origGreyscaleMap) greyMat.map = origGreyscaleMap;
            }

            // Don't set default color - fabrics will handle this
            greyMat.needsUpdate = true;

            // ── SPATIAL NAMING ─────────────────────────────────────────
            // Scraped GLBs have no useful names. Ignore them entirely and 
            // rely on world-space bounding-box geometry analysis.
            
            mesh.geometry.computeBoundingBox();
            const meshBox3 = new THREE.Box3().setFromObject(mesh);
            const mc  = meshBox3.getCenter(new THREE.Vector3());   // mesh center (world)
            const ms  = meshBox3.getSize(new THREE.Vector3());      // mesh size  (world)
            const wc  = worldCenter;
            const ws  = worldSize;

            // Normalised relative positions  (-1 … +1 range)
            const relY = (mc.y - wc.y) / (ws.y * 0.5);   // -1 = very bottom, +1 = very top
            const relZ = (mc.z - wc.z) / (ws.z * 0.5);   // -1 = very back,   +1 = very front
            const relX = (mc.x - wc.x) / (ws.x * 0.5);   // -1 = far left,    +1 = far right
            const absX = Math.abs(relX);

            // Volume ratio vs entire model bounding volume
            const meshVol  = ms.x * ms.y * ms.z;
            const worldVol = ws.x * ws.y * ws.z;
            const volRatio = worldVol > 0 ? meshVol / worldVol : 0;

            // Flatness: a very flat mesh (e.g. thin seam / stitching line) has
            // one dimension much smaller than the other two.
            const dims    = [ms.x, ms.y, ms.z].sort((a, b) => a - b);
            const flatness = dims[2] > 0 ? dims[0] / dims[2] : 1; // 0 = very flat, 1 = cube

            let cleanName = '';

            // 1. Legs / base  — low Y, typically small volume, roughly symmetric
            if (relY < -0.55) {
              cleanName = 'Legs / Base';

            // 2. Backrest — high Z (rear), upper half of model
            } else if (relZ < -0.35 && relY > -0.3) {
              cleanName = 'Backrest';

            // 3. Armrests — far left or right, mid height
            } else if (absX > 0.55 && relY > -0.4) {
              cleanName = relX > 0 ? 'Right Armrest' : 'Left Armrest';

            // 4. Seat cushion — front-centre, middle height
            } else if (relZ > 0.0 && relY > -0.3 && relY < 0.4 && absX < 0.5) {
              cleanName = 'Seat Cushion';

            // 5. Stitching / seam — very flat or very small volume
            } else if (flatness < 0.06 || volRatio < 0.0008) {
              cleanName = 'Stitching';

            // 6. Legs ambiguous — low Y but not caught above
            } else if (relY < -0.35 && volRatio < 0.02) {
              cleanName = 'Legs / Base';

            // 7. Large central body
            } else if (volRatio > 0.12) {
              cleanName = 'Main Body';

            // 8. Mid-body panels
            } else if (relY > -0.1 && relY < 0.55 && absX < 0.55) {
              cleanName = 'Body Panel';

            } else {
              cleanName = 'Frame';
            }

            const size = ms;
            const maxDim = Math.max(size.x, size.y, size.z);
            const uvScaleFactor = maxDim > 0 ? maxDim : 1;

            newEntries.push({
              id: `mesh-${meshCounter}-${index}`,
              name: cleanName,
              mesh,
              matIndex: index,
              origMat,
              greyMat,
              origGreyscaleMap, 
              checked: false,
              uvScaleFactor
            });
            meshCounter++;
          });
        });

        setMeshEntries(() => {
          // Deduplicate names: if multiple entries share the same name, append a number
          const nameCounts: Record<string, number> = {};
          const nameIndex: Record<string, number> = {};
          newEntries.forEach(e => { nameCounts[e.name] = (nameCounts[e.name] || 0) + 1; });
          return newEntries.map(e => {
            if (nameCounts[e.name] > 1) {
              nameIndex[e.name] = (nameIndex[e.name] || 0) + 1;
              return { ...e, name: `${e.name} ${nameIndex[e.name]}` };
            }
            return e;
          });
        });
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
      showToast('Failed to parse GLB: ' + ((err as any).message || String(err)));
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
            const finalScale = texScale;
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

  const applyBaseColor = (hex: string) => {
    setBaseColorHex(hex);
    setLoading(true);
    setLoadingMsg('Applying colour...');
    const color = new THREE.Color(hex);
    setMeshEntries(prev => {
      const next = [...prev];
      next.forEach(entry => {
        if (!entry.checked) return;
        entry.greyMat.map = null;
        entry.greyMat.color.copy(color).multiplyScalar(brightness);
        entry.greyMat.needsUpdate = true;
      });
      return next;
    });
    setPbrTextures(prev => ({ ...prev, map: null }));
    setActiveFabricName(`Solid Colour ${hex.toUpperCase()}`);
    setTimeout(() => setLoading(false), 200);
  };

  const applyFabricPreset = async (presetId: string) => {
    const preset = FABRIC_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    const hasChecked = meshEntries.some(e => e.checked);
    if (!hasChecked) { showToast("Select a part first!"); return; }

    setSelectedPreset(presetId);
    setLoading(true);
    setLoadingMsg('Loading preset maps...');

    try {
      const loadTex = (url: string, srgb: boolean) => new Promise<THREE.Texture>((resolve, reject) => {
        new THREE.TextureLoader().load(url, (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
          t.flipY = false;
          resolve(t);
        }, undefined, reject);
      });

      const [normTex, roughTex] = await Promise.all([
        loadTex(preset.normalUrl, false).catch(() => null),
        loadTex(preset.roughnessUrl, false).catch(() => null),
      ]);

      setPbrTextures(prev => ({
        ...prev,
        normalMap: normTex,
        roughnessMap: roughTex,
      }));

      setRoughness(preset.roughness);
      setSheen(preset.sheen);

      setMeshEntries(prev => {
        const next = [...prev];
        next.forEach(entry => {
          if (!entry.checked) return;
          const mat = entry.greyMat;
          if (normTex) {
            const nt = normTex.clone();
            nt.repeat.set(texScale, texScale);
            nt.needsUpdate = true;
            mat.normalMap = nt;
            mat.normalScale.set(normScale, normScale);
          }
          if (roughTex) {
            const rt = roughTex.clone();
            rt.repeat.set(texScale, texScale);
            rt.needsUpdate = true;
            mat.roughnessMap = rt;
          }
          mat.roughness = preset.roughness;
          const s = Math.floor(preset.sheen * 255);
          mat.sheen = new THREE.Color(`rgb(${s},${s},${s})`);
          mat.needsUpdate = true;
        });
        return next;
      });

      showToast(`${preset.label} maps applied!`);
      setActiveFabricName(preset.label);
    } catch (e) {
      showToast('Failed to load preset maps');
    } finally {
      setLoading(false);
    }
  };


  const toggleMeshCheck = (id: string, checked: boolean) => {
    setMeshEntries(prev => prev.map(entry => {
      if (entry.id !== id) return entry;
      
      const newEntry = { ...entry, checked };
      
      // Always use indexed assignment — mesh.material is always an array now
      const matArray = [...(newEntry.mesh.material as THREE.Material[])];
      // BUG FIX 1: When checking, swap to greyMat as-is — DO NOT overwrite its
      // textures. Each greyMat already holds whatever fabric was last applied to
      // it via applyFabric/applyPolyFabric. Overwriting here was causing previously
      // applied fabrics to be replaced by the global pbrTextures state.
      matArray[newEntry.matIndex] = checked ? newEntry.greyMat : newEntry.origMat;
      newEntry.mesh.material = matArray;

      // Flash emissive highlight so user can see exactly which part got selected
      if (checked) {
        newEntry.greyMat.emissive = new THREE.Color(0x888800);
        newEntry.greyMat.emissiveIntensity = 0.4;
        newEntry.greyMat.needsUpdate = true;
        setTimeout(() => {
          newEntry.greyMat.emissive = new THREE.Color(0x000000);
          newEntry.greyMat.emissiveIntensity = 0;
          newEntry.greyMat.needsUpdate = true;
        }, 600);
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
    setActiveFabricName(fabric.name);
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
        const finalScale = val;
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

  const resetToDefault = async () => {
    // Reset all UI state
    setRoughness(defaultProperties.roughness);
    setMetalness(defaultProperties.metalness);
    setSheen(defaultProperties.sheen);
    setTexScale(defaultProperties.texScale);
    setNormScale(defaultProperties.normScale);
    setBrightness(defaultProperties.brightness);
    setPbrTextures({ map: null, normalMap: null, roughnessMap: null });
    setBaseColorHex('#ffffff');
    setSelectedPreset(null);
    setMeshEntries([]);
    setHasModel(false);

    // Reload default model
    try {
      setLoading(true);
      setLoadingMsg('Reloading Default Sofa...');
      const res = await fetch('https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/glbs/sofa_191.glb');
      const arrayBuffer = await res.arrayBuffer();
      onGLBBuffer(arrayBuffer);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
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

  const exportGLB = async () => {
    if (!currentModelRef.current) {
      showToast("Load a model first!");
      return;
    }

    setLoading(true);
    setLoadingMsg("Preparing export...");

    // ── helpers ──────────────────────────────────────────────────────────

    // Bake an HTMLImageElement texture onto a canvas so GLTFExporter can embed it
    const bakeTexIfNeeded = (tex: THREE.Texture | null): THREE.Texture | null => {
      if (!tex || !tex.image) return tex;
      if (tex.image instanceof HTMLCanvasElement) return tex;
      try {
        const img = tex.image as HTMLImageElement;
        const w = img.naturalWidth || img.width || 512;
        const h = img.naturalHeight || img.height || 512;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return tex;
        ctx.drawImage(img, 0, 0, w, h);
        const baked = new THREE.CanvasTexture(canvas);
        baked.encoding = tex.encoding;
        baked.wrapS = tex.wrapS; baked.wrapT = tex.wrapT;
        baked.repeat.copy(tex.repeat); baked.offset.copy(tex.offset);
        baked.flipY = tex.flipY; baked.needsUpdate = true;
        return baked;
      } catch (e) { return tex; }
    };

    // Export a Three.js Texture to a PNG Blob via canvas
    const texToBlob = (tex: THREE.Texture | null): Promise<Blob | null> => {
      if (!tex || !tex.image) return Promise.resolve(null);
      return new Promise(resolve => {
        try {
          const src = tex.image;
          const w = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width || 512;
          const h = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height || 512;
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
          canvas.toBlob(b => resolve(b), 'image/png');
        } catch { resolve(null); }
      });
    };

    // ── bake textures for GLTFExporter ────────────────────────────────────
    const bakedPairs: Array<{
      mat: THREE.MeshPhysicalMaterial;
      origMap: THREE.Texture | null;
      origNorm: THREE.Texture | null;
      origRough: THREE.Texture | null;
    }> = [];

    meshEntries.forEach(entry => {
      if (!entry.checked) return;
      const mat = entry.greyMat;
      const origMap = mat.map; const origNorm = mat.normalMap; const origRough = mat.roughnessMap;
      mat.map = bakeTexIfNeeded(mat.map);
      mat.normalMap = bakeTexIfNeeded(mat.normalMap);
      mat.roughnessMap = bakeTexIfNeeded(mat.roughnessMap);
      mat.needsUpdate = true;
      bakedPairs.push({ mat, origMap, origNorm, origRough });
    });

    const restoreTextures = () => {
      bakedPairs.forEach(({ mat, origMap, origNorm, origRough }) => {
        mat.map = origMap; mat.normalMap = origNorm; mat.roughnessMap = origRough;
        mat.needsUpdate = true;
      });
    };

    // ── export GLB ────────────────────────────────────────────────────────
    setLoadingMsg("Exporting GLB...");

    const glbBlob: Blob = await new Promise((resolve, reject) => {
      const exporter = new GLTFExporter();
      (exporter as any).parse(
        currentModelRef.current!,
        (gltf) => {
          restoreTextures();
          resolve(gltf instanceof ArrayBuffer
            ? new Blob([gltf], { type: 'application/octet-stream' })
            : new Blob([JSON.stringify(gltf)], { type: 'text/plain' }));
        },
        (err) => { restoreTextures(); reject(err); },
        { binary: true } as any
      );
    }).catch(err => {
      console.error(err);
      showToast("GLB export failed!");
      setLoading(false);
      return null;
    }) as Blob | null;

    if (!glbBlob) return;

    // ── collect texture blobs ─────────────────────────────────────────────
    setLoadingMsg("Packing textures...");

    // Gather unique textures across all checked parts
    const checkedEntries = meshEntries.filter(e => e.checked);
    // Use the first checked entry's greyMat as representative (they share the same applied textures)
    const repMat = checkedEntries[0]?.greyMat ?? null;
    const [diffBlob, normBlob, roughBlob] = await Promise.all([
      texToBlob(repMat?.map ?? null),
      texToBlob(repMat?.normalMap ?? null),
      texToBlob(repMat?.roughnessMap ?? null),
    ]);

    // ── build config.txt ──────────────────────────────────────────────────
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const partNames = checkedEntries.map(e => e.name).join(', ') || 'None';
    const fabricSource = fabricTab === 'polyhaven'
      ? `Polyhaven — ${selectedPolyFabric || 'unknown'}`
      : `Custom Library`;

    const configLines = [
      '═══════════════════════════════════════════',
      '  FABRIC CONFIGURATOR — EXPORT SUMMARY',
      '═══════════════════════════════════════════',
      '',
      `Exported At    : ${timestamp}`,
      '',
      '── FABRIC ──────────────────────────────────',
      `Fabric Name    : ${activeFabricName || 'Not specified'}`,
      `Source         : ${fabricSource}`,
      `Base Colour    : ${baseColorHex.toUpperCase()}`,
      '',
      '── SELECTED PARTS ──────────────────────────',
      `Parts          : ${partNames}`,
      '',
      '── MATERIAL SETTINGS ───────────────────────',
      `Brightness     : ${brightness.toFixed(2)}`,
      `Roughness      : ${roughness.toFixed(2)}`,
      `Metalness      : ${metalness.toFixed(2)}`,
      `Fabric Fuzz    : ${sheen.toFixed(2)}`,
      `Pattern Scale  : ${texScale.toFixed(1)}`,
      `Bump Strength  : ${normScale.toFixed(1)}`,
      '',
      '── TEXTURE FILES ───────────────────────────',
      `Diffuse Map    : ${diffBlob ? 'diffuse.png (included)' : 'none'}`,
      `Normal Map     : ${normBlob ? 'normal.png (included)' : 'none'}`,
      `Roughness Map  : ${roughBlob ? 'roughness.png (included)' : 'none'}`,
      '',
      '── FILES IN THIS ZIP ───────────────────────',
      '  customized_model.glb  — 3D model with embedded textures',
      '  config.txt            — this file',
      ...(diffBlob  ? ['  diffuse.png           — base colour / pattern map'] : []),
      ...(normBlob  ? ['  normal.png            — surface detail / bump map'] : []),
      ...(roughBlob ? ['  roughness.png         — matte/gloss map'] : []),
      '',
      '═══════════════════════════════════════════',
    ].join('\n');

    const configBlob = new Blob([configLines], { type: 'text/plain' });

    // ── build ZIP ─────────────────────────────────────────────────────────
    setLoadingMsg("Building ZIP...");

    // Load JSZip dynamically from CDN
    const JSZip = await (async () => {
      if ((window as any).JSZip) return (window as any).JSZip;
      await new Promise<void>((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = () => res();
        s.onerror = () => rej(new Error('JSZip load failed'));
        document.head.appendChild(s);
      });
      return (window as any).JSZip;
    })();

    const zip = new JSZip();
    const folderName = (activeFabricName || 'fabric_config').replace(/[^a-z0-9_\-\s]/gi, '').trim().replace(/\s+/g, '_') || 'fabric_config';

    zip.file('customized_model.glb', glbBlob);
    zip.file('config.txt', configBlob);
    if (diffBlob)  zip.file('diffuse.png', diffBlob);
    if (normBlob)  zip.file('normal.png', normBlob);
    if (roughBlob) zip.file('roughness.png', roughBlob);

    const zipBlob: Blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });

    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${folderName}_${Date.now()}.zip`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setLoading(false);
    showToast("ZIP downloaded — GLB + textures + config ✔");
  };

  return (
    <div className="flex flex-col h-screen bg-white text-gray-900 overflow-hidden">
      <header className="flex items-center justify-between px-8 py-4 border-b border-gray-200 shrink-0 bg-black">
        <div className="flex items-center gap-3">
          <img 
            src="https://nyvlydjdvhsunqbliqru.supabase.co/storage/v1/object/public/fabric_assets/logo.webp"
            alt="Livinit"
            className="h-10 w-auto object-contain"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-bold text-white tracking-widest uppercase" style={{ letterSpacing: '0.18em' }}>LIVINIT</span>
            <span className="text-[10px] font-medium text-gray-400 tracking-widest uppercase">AI Customiser</span>
          </div>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 px-5 py-2.5 rounded text-xs font-semibold cursor-pointer transition-colors shadow-sm">
            Upload GLB
            <input type="file" accept=".glb,.gltf" onChange={(e) => handleFile(e.target.files?.[0] || null)} className="hidden" />
          </label>
          <button 
            onClick={resetToDefault}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 px-5 py-2.5 rounded text-xs font-semibold transition-colors shadow-sm"
          >
            <RotateCcw size={14} /> Restart
          </button>
          <button 
            onClick={renderScene} 
            disabled={isRendering}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 px-5 py-2.5 rounded text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
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
          
          {/* Fabric Library */}
          <div className="p-6 border-b border-gray-100">
            <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-5">Fabric Library</div>
            
            <div className="space-y-5">
              {/* Base Color */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Base Colour</span>
                  <div className="relative group flex items-center">
                    <Info size={12} className="text-gray-400 cursor-help" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-900 text-white text-[10px] rounded shadow-lg z-50 normal-case tracking-normal font-normal text-center">
                      Pick a solid colour or upload a pattern image. The colour is applied as a tint.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
                {/* Color swatch row + picker */}
                <div className="flex items-center gap-3 mb-2">
                  {['#ffffff','#f5e6d3','#d4b896','#8b6f47','#4a3728','#2c2c2c','#e8d5c4','#c9a882','#7a9b8c','#5b7fa6','#8b4444','#6b5b8b'].map(c => (
                    <button
                      key={c}
                      onClick={() => applyBaseColor(c)}
                      className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                      style={{ backgroundColor: c, borderColor: baseColorHex === c ? '#000' : '#e5e7eb' }}
                    />
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <div className="flex items-center gap-2 flex-1 border border-gray-200 rounded px-3 py-2 bg-gray-50 hover:border-gray-300 transition-colors cursor-pointer"
                    onClick={() => document.getElementById('base-color-picker')?.click()}
                  >
                    <div className="w-5 h-5 rounded border border-gray-300 flex-shrink-0" style={{ backgroundColor: baseColorHex }} />
                    <span className="text-xs text-gray-600 font-medium">{baseColorHex.toUpperCase()}</span>
                    <input id="base-color-picker" type="color" value={baseColorHex} onChange={(e) => applyBaseColor(e.target.value)} className="hidden" />
                    <span className="text-[10px] text-gray-400 ml-auto">Custom</span>
                  </div>
                  <label className={`flex items-center gap-2 px-3 py-2 border rounded text-xs font-medium cursor-pointer transition-colors flex-shrink-0 ${pbrTextures.map ? 'border-black text-black bg-gray-50' : 'border-gray-200 text-gray-500 bg-gray-50 hover:border-gray-300'}`}>
                    {pbrTextures.map ? <><Check size={11} /> Pattern</> : '+ Pattern'}
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => loadPBRMap(e.target.files?.[0] || null, 'map')} />
                  </label>
                </div>
              </div>

              {/* Fabric Type Presets (Normal + Roughness) */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Fabric Type</span>
                  <div className="relative group flex items-center">
                    <Info size={12} className="text-gray-400 cursor-help" />
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-gray-900 text-white text-[10px] rounded shadow-lg z-50 normal-case tracking-normal font-normal text-center">
                      Choose a preset to apply matching Normal + Roughness maps. You can still override with custom images below.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {FABRIC_PRESETS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => applyFabricPreset(p.id)}
                      className={`px-3 py-2.5 border rounded text-xs font-semibold transition-all ${selectedPreset === p.id ? 'border-black bg-black text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400 hover:text-black bg-white'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Override Maps */}
              <div className="pt-1">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Custom Override Maps</div>
                <div className="space-y-2">
                  <label className={`flex justify-between items-center w-full px-3 py-2.5 text-left bg-gray-50 border rounded text-xs font-medium cursor-pointer transition-colors ${pbrTextures.normalMap ? 'border-black text-black' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    <span>Normal Map</span>
                    {pbrTextures.normalMap ? <span className="text-black text-[10px]">✔ Custom</span> : <span className="text-[10px] text-gray-400">Upload to override</span>}
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => { loadPBRMap(e.target.files?.[0] || null, 'normalMap'); setSelectedPreset(null); }} />
                  </label>
                  <label className={`flex justify-between items-center w-full px-3 py-2.5 text-left bg-gray-50 border rounded text-xs font-medium cursor-pointer transition-colors ${pbrTextures.roughnessMap ? 'border-black text-black' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    <span>Roughness Map</span>
                    {pbrTextures.roughnessMap ? <span className="text-black text-[10px]">✔ Custom</span> : <span className="text-[10px] text-gray-400">Upload to override</span>}
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => { loadPBRMap(e.target.files?.[0] || null, 'roughnessMap'); setSelectedPreset(null); }} />
                  </label>
                </div>
              </div>
            </div>
          </div>


          {/* Fabric Selection — Tabbed: Custom | Polyhaven */}
          <div className="p-6">
            {/* Tab switcher */}
            <div className="flex border border-gray-200 rounded overflow-hidden mb-4">
              <button
                onClick={() => setFabricTab('custom')}
                className={`flex-1 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors ${fabricTab === 'custom' ? 'bg-black text-white' : 'bg-white text-gray-400 hover:text-gray-700'}`}
              >
                Custom
              </button>
              <button
                onClick={() => setFabricTab('polyhaven')}
                className={`flex-1 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors flex items-center justify-center gap-2 ${fabricTab === 'polyhaven' ? 'bg-black text-white' : 'bg-white text-gray-400 hover:text-gray-700'}`}
              >
                Polyhaven
                {polyLoading && <div className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />}
              </button>
            </div>

            {fabricTab === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                {fabricLibrary.map((fab, idx) => (
                  <div key={idx} className="flex flex-col items-center gap-2">
                    <div
                      className="w-full aspect-square cursor-pointer border-2 border-transparent hover:border-gray-300 transition-all bg-gray-50 flex items-center justify-center overflow-hidden rounded"
                      onClick={() => applyFabric(idx)}
                    >
                      {fabricThumbnails[idx] ? (
                        <img src={fabricThumbnails[idx]!} alt={fab.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-[10px] text-gray-400 text-center px-2">{fab.name}</div>
                      )}
                    </div>
                    <span className="text-[10px] font-medium text-gray-500 truncate w-full text-center">{fab.name}</span>
                  </div>
                ))}
              </div>
            )}

            {fabricTab === 'polyhaven' && (
              <>
                {polyFabrics.length === 0 && polyLoading && (
                  <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-400">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
                    <span className="text-[10px] uppercase tracking-widest">Loading fabrics...</span>
                  </div>
                )}
                {polyFabrics.length === 0 && !polyLoading && (
                  <div className="text-[10px] text-gray-400 text-center py-6">Polyhaven unavailable</div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {polyFabrics.map((fab) => (
                    <div key={fab.id} className="flex flex-col items-center gap-1.5">
                      <div
                        className={`w-full aspect-square cursor-pointer border-2 transition-all bg-gray-50 flex items-center justify-center overflow-hidden rounded ${selectedPolyFabric === fab.id ? 'border-black' : 'border-transparent hover:border-gray-300'}`}
                        onClick={() => applyPolyFabric(fab)}
                      >
                        <img src={fab.thumb} alt={fab.name} className="w-full h-full object-cover" />
                      </div>
                      <span className="text-[10px] font-medium text-gray-500 truncate w-full text-center leading-tight">{fab.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
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
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400">1. Select Parts</div>
              {meshEntries.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => meshEntries.forEach(e => { if (!e.checked) toggleMeshCheck(e.id, true); })}
                    className="text-[10px] text-gray-400 hover:text-black transition-colors font-semibold uppercase tracking-wider"
                  >All</button>
                  <span className="text-gray-200">|</span>
                  <button
                    onClick={() => meshEntries.forEach(e => { if (e.checked) toggleMeshCheck(e.id, false); })}
                    className="text-[10px] text-gray-400 hover:text-black transition-colors font-semibold uppercase tracking-wider"
                  >None</button>
                </div>
              )}
            </div>
            {!hasModel && <div className="text-xs text-gray-400 italic">Load a GLB first</div>}
            <div className="flex flex-col gap-1.5">
              {meshEntries.map(entry => {
                // Zone colour dot — gives instant visual cue about which region
                const zoneColor: Record<string, string> = {
                  'Seat Cushion':    '#a78bfa',
                  'Backrest':        '#60a5fa',
                  'Left Armrest':    '#34d399',
                  'Right Armrest':   '#34d399',
                  'Legs / Base':     '#f87171',
                  'Main Body':       '#fbbf24',
                  'Body Panel':      '#fbbf24',
                  'Stitching':       '#94a3b8',
                  'Frame':           '#f97316',
                };
                // strip trailing number for lookup
                const baseName = entry.name.replace(/ \d+$/, '');
                const dot = zoneColor[baseName] || '#cbd5e1';

                return (
                  <label
                    key={entry.id}
                    className={`flex items-center gap-3 px-3 py-2.5 border rounded cursor-pointer transition-all select-none ${entry.checked ? 'border-black bg-gray-50 shadow-sm' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'}`}
                    onMouseEnter={() => {
                      // Brief emissive pulse on hover so user can preview which part in 3D
                      entry.greyMat.emissive = new THREE.Color(0x444400);
                      entry.greyMat.emissiveIntensity = 0.25;
                      entry.greyMat.needsUpdate = true;
                      // Also pulse the original material if not checked
                      if (!entry.checked) {
                        const origAny = entry.origMat as any;
                        if (origAny.emissive !== undefined) {
                          origAny._prevEmissive = origAny.emissive.clone();
                          origAny.emissive = new THREE.Color(0x444400);
                          origAny.emissiveIntensity = 0.25;
                          origAny.needsUpdate = true;
                        }
                      }
                    }}
                    onMouseLeave={() => {
                      entry.greyMat.emissive = new THREE.Color(0x000000);
                      entry.greyMat.emissiveIntensity = 0;
                      entry.greyMat.needsUpdate = true;
                      if (!entry.checked) {
                        const origAny = entry.origMat as any;
                        if (origAny._prevEmissive !== undefined) {
                          origAny.emissive = origAny._prevEmissive;
                          origAny.emissiveIntensity = 0;
                          origAny.needsUpdate = true;
                        }
                      }
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={entry.checked} 
                      onChange={(e) => toggleMeshCheck(entry.id, e.target.checked)}
                      className="w-4 h-4 accent-black cursor-pointer flex-shrink-0"
                    />
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
                    <span className={`text-xs font-medium leading-tight ${entry.checked ? 'text-black' : 'text-gray-600'}`}>{entry.name}</span>
                  </label>
                );
              })}
            </div>
            {meshEntries.length > 0 && (
              <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">Hover a part to highlight it in the 3D view. Check to select, then apply fabric or colour.</p>
            )}
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

      {/* Polyhaven Colour Variant Picker Modal */}
      {polyVariantModal && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md">
            <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-sm font-bold text-gray-900">{polyVariantModal.fabric.name}</h2>
                <p className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wider">Choose a colour variant</p>
              </div>
              <button onClick={() => setPolyVariantModal(null)} className="text-gray-400 hover:text-black transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-3 gap-3">
                {getColourVariants(polyVariantModal.files, polyVariantModal.fabric.id).map(variant => (
                  <button
                    key={variant.key}
                    onClick={() => applyPolyFabric(polyVariantModal.fabric, variant.diffUrl)}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div className="w-full aspect-square rounded border-2 border-transparent group-hover:border-black transition-all overflow-hidden bg-gray-100">
                      <img
                        src={variant.diffUrl}
                        alt={variant.label}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-gray-600 group-hover:text-black transition-colors">{variant.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

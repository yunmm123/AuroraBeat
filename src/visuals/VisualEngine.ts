import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass'
import type { AudioFeatures, VisualEffectType } from '@/types'

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.003 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec2 direction = vUv - 0.5;
      float dist = length(direction) * 2.0;
      vec2 offset = normalize(direction) * uStrength * dist * dist;
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
}

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDarkness: { value: 0.4 },
    uOffset: { value: 0.1 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uDarkness;
    uniform float uOffset;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * 2.0;
      float dist = dot(uv, uv);
      color.rgb *= 1.0 - dist * uDarkness + uOffset;
      gl_FragColor = color;
    }
  `,
}

export class VisualEngine {
  private container: HTMLElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer

  private clock: THREE.Clock
  private animationId: number | null = null

  private audioDataTexture: THREE.DataTexture
  private audioDataArray: Uint8Array<ArrayBuffer>

  private primaryColor: THREE.Color = new THREE.Color(0x8b5cf6)
  private secondaryColor: THREE.Color = new THREE.Color(0x6366f1)
  private accentColor: THREE.Color = new THREE.Color(0xa78bfa)

  private bloomPass: UnrealBloomPass
  private chromaticAberrationPass: ShaderPass
  private vignettePass: ShaderPass

  private isPaused = false
  private quality: 'low' | 'medium' | 'high' | 'ultra' = 'high'

  // Main particle system
  private particleSystem: THREE.Points | null = null
  private particleMaterial: THREE.ShaderMaterial | null = null
  private particleCount = 0

  // Ring particles (orbit around center)
  private ringParticleSystem: THREE.Points | null = null
  private ringParticleMaterial: THREE.ShaderMaterial | null = null

  // Wave particles (flow upward)
  private waveParticleSystem: THREE.Points | null = null
  private waveParticleMaterial: THREE.ShaderMaterial | null = null

  // Trail particle system
  private trailSystem: THREE.Points | null = null
  private trailMaterial: THREE.ShaderMaterial | null = null

  // Waveform visualizer rings
  private waveformRings: THREE.Points[] = []
  private waveformRingMaterials: THREE.ShaderMaterial[] = []

  // Album art display
  private albumArtMesh: THREE.Mesh | null = null
  private albumArtGlowRing: THREE.Mesh | null = null
  private albumArtLoading = false
  private textureLoader: THREE.TextureLoader

  // Background gradient
  private bgPlane: THREE.Mesh | null = null
  private bgMaterial: THREE.ShaderMaterial | null = null

  // Mood color transition
  private moodColor: THREE.Color = new THREE.Color(0x8b5cf6)
  private targetMoodColor: THREE.Color = new THREE.Color(0x8b5cf6)

  // Beat pulse
  private lastBeatTime = 0
  private beatFlash = 0

  constructor(container: HTMLElement) {
    this.container = container

    this.clock = new THREE.Clock()
    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    )
    this.camera.position.z = 25

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    container.appendChild(this.renderer.domElement)

    this.textureLoader = new THREE.TextureLoader()

    this.audioDataArray = new Uint8Array(128) as unknown as Uint8Array<ArrayBuffer>
    this.audioDataTexture = new THREE.DataTexture(
      this.audioDataArray,
      128,
      1,
      THREE.RedFormat,
      THREE.UnsignedByteType
    )
    this.audioDataTexture.needsUpdate = true

    this.composer = new EffectComposer(this.renderer)
    const renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(renderPass)

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.8,
      0.4,
      0.85
    )
    this.composer.addPass(this.bloomPass)

    this.chromaticAberrationPass = new ShaderPass(ChromaticAberrationShader)
    ;(this.chromaticAberrationPass as any).renderToScreen = false
    this.composer.addPass(this.chromaticAberrationPass)

    this.vignettePass = new ShaderPass(VignetteShader)
    ;(this.vignettePass as any).renderToScreen = true
    this.composer.addPass(this.vignettePass)

    this.initBackground()
    this.initLyricsParticles()
    this.initRingParticles()
    this.initWaveParticles()
    this.initTrailParticles()
    this.initWaveformRings()
    this.initAlbumArtDisplay()

    window.addEventListener('resize', this.handleResize)
  }

  private initBackground() {
    const geometry = new THREE.PlaneGeometry(80, 60)
    const material = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        void main() {
          vUv = uv;
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        uniform vec3 uColor3;
        uniform float uTime;
        uniform float uBeatIntensity;
        void main() {
          vec3 baseColor = mix(uColor1, uColor2, vUv.y * 0.7 + 0.15);
          baseColor = mix(baseColor, uColor3, sin(vUv.x * 3.0 + uTime * 0.1) * 0.5 + 0.5);
          
          // Subtle animated noise
          float n = sin(vUv.x * 20.0 + uTime * 0.3) * cos(vUv.y * 15.0 + uTime * 0.2) * 0.08;
          baseColor += n;
          
          // Beat pulse brightening
          baseColor += uBeatIntensity * 0.06;
          
          // Vignette
          float vignette = 1.0 - length(vUv - 0.5) * 0.8;
          baseColor *= vignette;
          
          gl_FragColor = vec4(baseColor, 0.5 + vignette * 0.5);
        }
      `,
      uniforms: {
        uColor1: { value: this.primaryColor },
        uColor2: { value: this.secondaryColor },
        uColor3: { value: this.accentColor },
        uTime: { value: 0 },
        uBeatIntensity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    })
    const plane = new THREE.Mesh(geometry, material)
    plane.position.z = -30
    this.scene.add(plane)
    this.bgPlane = plane
    this.bgMaterial = material
  }

  private initLyricsParticles() {
    const count = this.getParticleCount()
    this.particleCount = count

    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const speeds = new Float32Array(count)
    const phases = new Float32Array(count)
    const types = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      positions[i3] = (Math.random() - 0.5) * 40
      positions[i3 + 1] = (Math.random() - 0.5) * 30
      positions[i3 + 2] = (Math.random() - 0.5) * 20 - 5

      const hue = Math.random() * 0.3 + 0.6
      const color = new THREE.Color().setHSL(hue, 0.7, 0.5 + Math.random() * 0.3)
      colors[i3] = color.r
      colors[i3 + 1] = color.g
      colors[i3 + 2] = color.b

      sizes[i] = Math.random() * 1.5 + 0.3
      speeds[i] = Math.random() * 0.3 + 0.1
      phases[i] = Math.random() * Math.PI * 2
      types[i] = Math.floor(Math.random() * 3) // 0: float, 1: orbit, 2: drift
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1))
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1))
    geometry.setAttribute('type', new THREE.BufferAttribute(types, 1))

    const material = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float size;
        attribute float speed;
        attribute float phase;
        attribute vec3 customColor;
        attribute float type;
        
        uniform float uTime;
        uniform float uBeatIntensity;
        uniform float uLowFreq;
        uniform float uMidFreq;
        uniform float uHighFreq;
        uniform float uPointSize;
        
        varying vec3 vColor;
        varying float vAlpha;
        
        void main() {
          vColor = customColor;
          vec3 pos = position;
          float t = uTime * speed + phase;
          
          if (type < 0.5) {
            // Floating particles
            pos.x += sin(t * 0.7) * 2.5;
            pos.y += cos(t * 0.5) * 2.0;
            pos.z += sin(t * 0.3) * 1.5;
          } else if (type < 1.5) {
            // Orbiting particles
            float orbitRadius = length(pos.xy) + 5.0;
            float orbitAngle = atan(pos.y, pos.x) + t * 0.3;
            pos.x = cos(orbitAngle) * orbitRadius;
            pos.y = sin(orbitAngle) * orbitRadius;
            pos.z += sin(t * 0.4) * 2.0;
          } else {
            // Drifting particles
            pos.x += t * 0.5;
            pos.y += sin(t * 0.6) * 3.0;
            pos.z += cos(t * 0.4) * 2.0;
          }
          
          // Beat pulse
          float beatPulse = uBeatIntensity * 3.5;
          vec3 dir = normalize(pos);
          pos += dir * beatPulse * sin(t * 2.0) * 0.6;
          
          // Low freq wave
          pos.y += sin(uTime * 0.8 + pos.x * 0.3) * uLowFreq * 2.5;
          
          // High freq shimmer
          pos.x += sin(uTime * 1.5 + pos.y * 0.5) * uHighFreq * 0.8;
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          float dist = length(mvPosition.xyz);
          vAlpha = smoothstep(35.0, 8.0, dist) * (0.35 + uMidFreq * 0.4);
          
          gl_PointSize = size * uPointSize * (220.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          
          float alpha = smoothstep(0.5, 0.05, d) * vAlpha;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uBeatIntensity: { value: 0 },
        uLowFreq: { value: 0 },
        uMidFreq: { value: 0 },
        uHighFreq: { value: 0 },
        uPointSize: { value: 1.0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    this.particleSystem = points
    this.particleMaterial = material
  }

  private initRingParticles() {
    const count = Math.floor(this.getParticleCount() * 0.4)
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const speeds = new Float32Array(count)
    const angles = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const angle = (i / count) * Math.PI * 2
      const radius = 8 + Math.random() * 12
      positions[i3] = Math.cos(angle) * radius
      positions[i3 + 1] = Math.sin(angle) * radius
      positions[i3 + 2] = (Math.random() - 0.5) * 4

      const hue = 0.55 + Math.random() * 0.15
      const color = new THREE.Color().setHSL(hue, 0.8, 0.6 + Math.random() * 0.3)
      colors[i3] = color.r
      colors[i3 + 1] = color.g
      colors[i3 + 2] = color.b

      sizes[i] = Math.random() * 1.0 + 0.2
      speeds[i] = Math.random() * 0.5 + 0.2
      angles[i] = angle
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1))
    geometry.setAttribute('angle', new THREE.BufferAttribute(angles, 1))

    const material = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float size;
        attribute float speed;
        attribute float angle;
        attribute vec3 customColor;
        uniform float uTime;
        uniform float uBeatIntensity;
        uniform float uMidFreq;
        uniform float uPointSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = customColor;
          float radius = length(position.xy);
          float baseAngle = angle + uTime * speed * 0.15;
          float r = radius + uBeatIntensity * 1.5 + uMidFreq * 2.0;
          vec3 pos = vec3(cos(baseAngle) * r, sin(baseAngle) * r, position.z);
          pos.z += sin(uTime * 0.5 + angle * 3.0) * uBeatIntensity * 1.5;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          float dist = length(mvPosition.xyz);
          vAlpha = smoothstep(30.0, 5.0, dist) * 0.5;
          gl_PointSize = size * uPointSize * (180.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.05, d) * vAlpha;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uBeatIntensity: { value: 0 },
        uMidFreq: { value: 0 },
        uPointSize: { value: 1.0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    this.ringParticleSystem = points
    this.ringParticleMaterial = material
  }

  private initWaveParticles() {
    const count = Math.floor(this.getParticleCount() * 0.3)
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const offsets = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      positions[i3] = (Math.random() - 0.5) * 30
      positions[i3 + 1] = (Math.random() - 0.5) * 4 - 10
      positions[i3 + 2] = (Math.random() - 0.5) * 10

      const hue = 0.65 + Math.random() * 0.2
      const color = new THREE.Color().setHSL(hue, 0.6, 0.5 + Math.random() * 0.4)
      colors[i3] = color.r
      colors[i3 + 1] = color.g
      colors[i3 + 2] = color.b

      sizes[i] = Math.random() * 0.8 + 0.2
      offsets[i] = Math.random() * Math.PI * 2
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1))

    const material = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float size;
        attribute float offset;
        attribute vec3 customColor;
        uniform float uTime;
        uniform float uLowFreq;
        uniform float uHighFreq;
        uniform float uPointSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = customColor;
          vec3 pos = position;
          pos.x += sin(uTime * 0.6 + offset) * 3.0 * uLowFreq;
          pos.y += uTime * 1.5 * (0.5 + uLowFreq);
          pos.z += cos(uTime * 0.4 + offset) * 2.0 * uHighFreq;
          // Wrap Y
          pos.y = mod(pos.y + 15.0, 30.0) - 15.0;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          float dist = length(mvPosition.xyz);
          vAlpha = smoothstep(25.0, 5.0, dist) * 0.4;
          gl_PointSize = size * uPointSize * (150.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.05, d) * vAlpha;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uLowFreq: { value: 0 },
        uHighFreq: { value: 0 },
        uPointSize: { value: 1.0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    this.waveParticleSystem = points
    this.waveParticleMaterial = material
  }

  private initTrailParticles() {
    const count = Math.floor(this.getParticleCount() * 0.2)
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const lifetimes = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      positions[i3] = (Math.random() - 0.5) * 40
      positions[i3 + 1] = (Math.random() - 0.5) * 30
      positions[i3 + 2] = (Math.random() - 0.5) * 20

      const color = new THREE.Color().setHSL(0.7, 0.9, 0.6 + Math.random() * 0.3)
      colors[i3] = color.r
      colors[i3 + 1] = color.g
      colors[i3 + 2] = color.b

      sizes[i] = Math.random() * 0.6 + 0.1
      lifetimes[i] = Math.random()
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1))

    const material = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float size;
        attribute float lifetime;
        attribute vec3 customColor;
        uniform float uTime;
        uniform float uBeatIntensity;
        uniform float uPointSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = customColor;
          vec3 pos = position;
          float life = fract(lifetime + uTime * 0.02);
          pos += normalize(position) * life * 5.0 * uBeatIntensity;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          vAlpha = (1.0 - life) * 0.4;
          gl_PointSize = size * uPointSize * (1.0 - life * 0.5) * (180.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.1, d) * vAlpha;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uBeatIntensity: { value: 0 },
        uPointSize: { value: 1.0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    this.trailSystem = points
    this.trailMaterial = material
  }

  private initWaveformRings() {
    const ringCount = 3
    const baseRadii = [6, 9, 12]
    const segments = 256

    for (let r = 0; r < ringCount; r++) {
      const geometry = new THREE.BufferGeometry()
      const positions = new Float32Array(segments * 3)
      const freqIndices = new Float32Array(segments)

      for (let i = 0; i < segments; i++) {
        const i3 = i * 3
        const angle = (i / segments) * Math.PI * 2
        positions[i3] = Math.cos(angle)
        positions[i3 + 1] = Math.sin(angle)
        positions[i3 + 2] = 0
        freqIndices[i] = i / segments
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('freqIndex', new THREE.BufferAttribute(freqIndices, 1))

      const material = new THREE.ShaderMaterial({
        vertexShader: `
          attribute float freqIndex;
          uniform sampler2D uAudioData;
          uniform float uBaseRadius;
          uniform float uMaxDisplacement;
          uniform float uTime;
          uniform float uBeatIntensity;
          uniform float uPointSize;
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float freq = texture2D(uAudioData, vec2(freqIndex, 0.5)).r;
            float angle = freqIndex * 3.14159265 * 2.0;
            float radius = uBaseRadius + freq * uMaxDisplacement + uBeatIntensity * 0.5;
            vec3 pos = vec3(cos(angle) * radius, sin(angle) * radius, 0.0);
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            vAlpha = 0.3 + freq * 0.7;
            float hue = 0.6 + freq * 0.2;
            vColor = vec3(
              0.5 + 0.5 * cos(6.28318 * (hue + 0.0)),
              0.5 + 0.5 * cos(6.28318 * (hue + 0.33)),
              0.5 + 0.5 * cos(6.28318 * (hue + 0.67))
            );
            gl_PointSize = uPointSize * (2.5 + freq * 3.0) * (200.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            float alpha = smoothstep(0.5, 0.02, d) * vAlpha;
            gl_FragColor = vec4(vColor, alpha);
          }
        `,
        uniforms: {
          uAudioData: { value: this.audioDataTexture },
          uBaseRadius: { value: baseRadii[r] },
          uMaxDisplacement: { value: 2.0 + r * 1.5 },
          uTime: { value: 0 },
          uBeatIntensity: { value: 0 },
          uPointSize: { value: 1.0 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })

      const points = new THREE.Points(geometry, material)
      this.scene.add(points)
      this.waveformRings.push(points)
      this.waveformRingMaterials.push(material)
    }
  }

  private initAlbumArtDisplay() {
    // Create a circular album art mesh
    const geometry = new THREE.CircleGeometry(3.5, 64)
    const material = new THREE.MeshBasicMaterial({
      color: 0x222233,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    this.albumArtMesh = new THREE.Mesh(geometry, material)
    this.albumArtMesh.position.z = -2
    this.albumArtMesh.visible = false
    this.scene.add(this.albumArtMesh)

    // Glow ring around album art
    const ringGeometry = new THREE.TorusGeometry(3.7, 0.08, 32, 128)
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    })
    this.albumArtGlowRing = new THREE.Mesh(ringGeometry, ringMaterial)
    this.albumArtGlowRing.position.z = -2
    this.albumArtGlowRing.visible = false
    this.scene.add(this.albumArtGlowRing)
  }

  private getParticleCount(): number {
    const counts = { low: 800, medium: 2000, high: 4000, ultra: 8000 }
    return counts[this.quality]
  }

  setEffect(_effect: VisualEffectType) {}

  setColors(primary: string, secondary: string, accent: string) {
    this.primaryColor.set(primary)
    this.secondaryColor.set(secondary)
    this.accentColor.set(accent)
    if (this.bgMaterial) {
      this.bgMaterial.uniforms.uColor1.value = this.primaryColor
      this.bgMaterial.uniforms.uColor2.value = this.secondaryColor
      this.bgMaterial.uniforms.uColor3.value = this.accentColor
    }
  }

  setSongInfo(coverUrl: string) {
    if (!coverUrl || this.albumArtLoading) return
    if (this.albumArtMesh && this.albumArtMesh.material) {
      const mat = this.albumArtMesh.material as THREE.MeshBasicMaterial
      if (mat.map && (mat.map as any).__src === coverUrl) return
    }

    this.albumArtLoading = true
    this.textureLoader.load(
      coverUrl,
      (texture) => {
        if (this.albumArtMesh) {
          const mat = this.albumArtMesh.material as THREE.MeshBasicMaterial
          mat.map = texture
          mat.color.set(0xffffff)
          mat.needsUpdate = true
          ;(texture as any).__src = coverUrl
          this.albumArtMesh.visible = true
          if (this.albumArtGlowRing) {
            this.albumArtGlowRing.visible = true
          }
        }
        this.albumArtLoading = false
        this.extractDominantColor(texture)
      },
      undefined,
      () => {
        this.albumArtLoading = false
        if (this.albumArtMesh) {
          this.albumArtMesh.visible = true
          const mat = this.albumArtMesh.material as THREE.MeshBasicMaterial
          mat.color.set(this.primaryColor)
          mat.needsUpdate = true
        }
        if (this.albumArtGlowRing) {
          this.albumArtGlowRing.visible = true
        }
      }
    )
  }

  private extractDominantColor(texture: THREE.Texture) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const image = (texture as any).image || texture.source?.data
      if (image instanceof HTMLImageElement || image instanceof ImageBitmap) {
        ctx.drawImage(image, 0, 0, 1, 1)
      } else if (image instanceof HTMLCanvasElement) {
        ctx.drawImage(image, 0, 0, 1, 1)
      } else {
        return
      }
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      this.targetMoodColor.setRGB(r / 255, g / 255, b / 255)
    } catch {
      // Fallback to theme color
    }
  }

  hideAlbumArt() {
    if (this.albumArtMesh) this.albumArtMesh.visible = false
    if (this.albumArtGlowRing) this.albumArtGlowRing.visible = false
  }

  updateAudio(features: AudioFeatures) {
    const spectrum = features.spectrum

    for (let i = 0; i < 128; i++) {
      const idx = Math.floor(i * (spectrum.length / 128))
      const val = Math.max(0, Math.min(1, (spectrum[idx] + 100) / 100))
      this.audioDataArray[i] = Math.floor(val * 255)
    }
    this.audioDataTexture.needsUpdate = true

    if (this.particleMaterial) {
      this.particleMaterial.uniforms.uBeatIntensity.value = features.beatIntensity
      this.particleMaterial.uniforms.uLowFreq.value = features.lowFrequency
      this.particleMaterial.uniforms.uMidFreq.value = features.midFrequency
      this.particleMaterial.uniforms.uHighFreq.value = features.highFrequency
    }

    if (this.ringParticleMaterial) {
      this.ringParticleMaterial.uniforms.uBeatIntensity.value = features.beatIntensity
      this.ringParticleMaterial.uniforms.uMidFreq.value = features.midFrequency
    }

    if (this.waveParticleMaterial) {
      this.waveParticleMaterial.uniforms.uLowFreq.value = features.lowFrequency
      this.waveParticleMaterial.uniforms.uHighFreq.value = features.highFrequency
    }

    if (this.trailMaterial) {
      this.trailMaterial.uniforms.uBeatIntensity.value = features.beatIntensity
    }

    for (const mat of this.waveformRingMaterials) {
      mat.uniforms.uBeatIntensity.value = features.beatIntensity
    }

    if (this.bgMaterial) {
      this.bgMaterial.uniforms.uBeatIntensity.value = features.beatIntensity
    }

    // Bloom reacts to beat
    this.bloomPass.strength = 0.4 + features.beatIntensity * 0.5

    // Chromatic aberration on beat
    this.chromaticAberrationPass.uniforms['uStrength'].value =
      0.002 + features.beatIntensity * 0.008

    // Beat flash
    if (features.isBeat) {
      this.beatFlash = 1.0
      this.lastBeatTime = this.clock.getElapsedTime()
    }

    // Mood-based color transitions
    const moodMap: Record<string, string> = {
      energetic: '#ff4444',
      calm: '#4488ff',
      sad: '#6644cc',
      happy: '#ffaa00',
      electronic: '#44ffcc',
      classical: '#ccaa88',
    }
    const moodColor = moodMap[features.mood]
    if (moodColor) {
      this.targetMoodColor.set(moodColor)
    }
  }

  start() {
    this.isPaused = false
    this.clock.start()
    this.animate()
  }

  pause() {
    this.isPaused = true
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  private animate = () => {
    if (this.isPaused) return

    this.animationId = requestAnimationFrame(this.animate)

    const delta = this.clock.getDelta()
    const time = this.clock.getElapsedTime()

    // Update all particle uniforms
    const uniformsList = [
      this.particleMaterial,
      this.ringParticleMaterial,
      this.waveParticleMaterial,
      this.trailMaterial,
      this.bgMaterial,
      ...this.waveformRingMaterials,
    ]

    for (const mat of uniformsList) {
      if (mat?.uniforms?.uTime) {
        mat.uniforms.uTime.value = time
      }
    }

    // Rotate systems
    if (this.particleSystem) {
      this.particleSystem.rotation.y += delta * 0.015
    }
    if (this.ringParticleSystem) {
      this.ringParticleSystem.rotation.z += delta * 0.01
    }
    if (this.waveParticleSystem) {
      this.waveParticleSystem.rotation.y -= delta * 0.008
    }

    // Album art rotation
    if (this.albumArtMesh?.visible) {
      this.albumArtMesh.rotation.z += delta * 0.15
    }
    if (this.albumArtGlowRing?.visible) {
      this.albumArtGlowRing.rotation.z += delta * 0.08
      const ringMat = this.albumArtGlowRing.material as THREE.MeshBasicMaterial
      ringMat.opacity = 0.4 + Math.sin(time * 2) * 0.2
    }

    // Mood color transition
    this.moodColor.lerp(this.targetMoodColor, delta * 0.5)
    if (this.albumArtGlowRing) {
      const ringMat = this.albumArtGlowRing.material as THREE.MeshBasicMaterial
      ringMat.color.copy(this.moodColor)
    }

    // Beat flash decay
    this.beatFlash *= 0.92
    this.bloomPass.strength += this.beatFlash * 0.3

    // Camera movement
    this.camera.position.x = Math.sin(time * 0.04) * 0.8
    this.camera.position.y = Math.cos(time * 0.03) * 0.5
    this.camera.lookAt(0, 0, 0)

    this.composer.render()
  }

  private handleResize = () => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    this.renderer.setSize(width, height)
    this.composer.setSize(width, height)
  }

  setQuality(quality: 'low' | 'medium' | 'high' | 'ultra') {
    this.quality = quality

    // Rebuild all particle systems
    const systems: Array<{ system: THREE.Points | null; rebuild: () => void }> = [
      { system: this.particleSystem, rebuild: () => this.initLyricsParticles() },
      { system: this.ringParticleSystem, rebuild: () => this.initRingParticles() },
      { system: this.waveParticleSystem, rebuild: () => this.initWaveParticles() },
      { system: this.trailSystem, rebuild: () => this.initTrailParticles() },
    ]

    for (const { system, rebuild } of systems) {
      if (system) {
        this.scene.remove(system)
        system.geometry.dispose()
      }
    }
    this.particleMaterial?.dispose()
    this.ringParticleMaterial?.dispose()
    this.waveParticleMaterial?.dispose()
    this.trailMaterial?.dispose()

    for (const { rebuild } of systems) {
      rebuild()
    }

    const bloomStrength = { low: 0.3, medium: 0.5, high: 0.8, ultra: 1.0 }
    this.bloomPass.strength = bloomStrength[quality]

    const pixelRatios = { low: 0.5, medium: 1.0, high: 1.5, ultra: 2.0 }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatios[quality]))

    const pointSizes = { low: 0.7, medium: 1.0, high: 1.2, ultra: 1.5 }
    const size = pointSizes[quality]
    for (const mat of [
      this.particleMaterial,
      this.ringParticleMaterial,
      this.waveParticleMaterial,
      this.trailMaterial,
    ]) {
      if (mat?.uniforms?.uPointSize) {
        mat.uniforms.uPointSize.value = size
      }
    }
    for (const mat of this.waveformRingMaterials) {
      if (mat.uniforms?.uPointSize) {
        mat.uniforms.uPointSize.value = size
      }
    }
  }

  destroy() {
    this.pause()
    window.removeEventListener('resize', this.handleResize)

    const cleanupPoints = (system: THREE.Points | null) => {
      if (system) {
        this.scene.remove(system)
        system.geometry.dispose()
      }
    }

    cleanupPoints(this.particleSystem)
    cleanupPoints(this.ringParticleSystem)
    cleanupPoints(this.waveParticleSystem)
    cleanupPoints(this.trailSystem)
    for (const ring of this.waveformRings) {
      cleanupPoints(ring)
    }

    this.particleMaterial?.dispose()
    this.ringParticleMaterial?.dispose()
    this.waveParticleMaterial?.dispose()
    this.trailMaterial?.dispose()
    for (const mat of this.waveformRingMaterials) {
      mat.dispose()
    }

    if (this.albumArtMesh) {
      this.scene.remove(this.albumArtMesh)
      this.albumArtMesh.geometry.dispose()
      ;(this.albumArtMesh.material as THREE.Material).dispose()
    }
    if (this.albumArtGlowRing) {
      this.scene.remove(this.albumArtGlowRing)
      this.albumArtGlowRing.geometry.dispose()
      ;(this.albumArtGlowRing.material as THREE.Material).dispose()
    }
    if (this.bgPlane) {
      this.scene.remove(this.bgPlane)
      this.bgPlane.geometry.dispose()
      this.bgMaterial?.dispose()
    }

    this.audioDataTexture.dispose()
    this.renderer.dispose()
    this.composer.dispose()

    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}
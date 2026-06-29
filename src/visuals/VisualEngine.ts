import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass'
import { particleVertexShader, particleFragmentShader } from '@/shaders/particleShaders'
import { fluidVertexShader, fluidFragmentShader } from '@/shaders/fluidShaders'
import { geometryVertexShader, geometryFragmentShader } from '@/shaders/geometryShaders'
import { nebulaVertexShader, nebulaFragmentShader } from '@/shaders/nebulaShaders'
import { waveformVertexShader, waveformFragmentShader } from '@/shaders/waveformShaders'
import type { AudioFeatures, VisualEffectType } from '@/types'

export class VisualEngine {
  private container: HTMLElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  
  private clock: THREE.Clock
  private animationId: number | null = null
  
  private currentEffect: VisualEffectType = 'particles'
  private effects: Map<VisualEffectType, THREE.Object3D> = new Map()
  private effectMaterials: Map<VisualEffectType, THREE.ShaderMaterial> = new Map()
  
  private audioDataTexture: THREE.DataTexture
  private audioDataArray: Uint8Array<ArrayBuffer>
  
  private primaryColor: THREE.Color = new THREE.Color(0x8b5cf6)
  private secondaryColor: THREE.Color = new THREE.Color(0x6366f1)
  private accentColor: THREE.Color = new THREE.Color(0xa78bfa)
  
  private bloomPass: UnrealBloomPass
  private chromaticAberrationPass: ShaderPass
  
  private isPaused = false
  private quality: 'low' | 'medium' | 'high' | 'ultra' = 'high'
  
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
    this.camera.position.z = 20
    
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    container.appendChild(this.renderer.domElement)
    
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
      1.0,
      0.4,
      0.85
    )
    this.composer.addPass(this.bloomPass)
    
    this.chromaticAberrationPass = this.createChromaticAberrationPass()
    this.composer.addPass(this.chromaticAberrationPass)
    
    this.initEffects()
    
    window.addEventListener('resize', this.handleResize)
  }
  
  private initEffects() {
    this.initParticleEffect()
    this.initFluidEffect()
    this.initGeometryEffect()
    this.initNebulaEffect()
    this.initWaveformEffect()
    
    this.setEffect('particles')
  }
  
  private initParticleEffect() {
    const particleCount = 5000
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)
    const sizes = new Float32Array(particleCount)
    const speeds = new Float32Array(particleCount)
    const indices = new Float32Array(particleCount)
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3
      const radius = Math.random() * 15 + 5
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      
      positions[i3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      positions[i3 + 2] = radius * Math.cos(phi)
      
      const color = new THREE.Color().setHSL(
        Math.random() * 0.3 + 0.6,
        0.8,
        0.6
      )
      colors[i3] = color.r
      colors[i3 + 1] = color.g
      colors[i3 + 2] = color.b
      
      sizes[i] = Math.random() * 2 + 0.5
      speeds[i] = Math.random() * 0.5 + 0.5
      indices[i] = i
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1))
    geometry.setAttribute('index', new THREE.BufferAttribute(indices, 1))
    
    const material = new THREE.ShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
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
    points.visible = false
    this.scene.add(points)
    this.effects.set('particles', points)
    this.effectMaterials.set('particles', material)
  }
  
  private initFluidEffect() {
    const geometry = new THREE.PlaneGeometry(40, 40, 1, 1)
    const material = new THREE.ShaderMaterial({
      vertexShader: fluidVertexShader,
      fragmentShader: fluidFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBeatIntensity: { value: 0 },
        uLowFreq: { value: 0 },
        uMidFreq: { value: 0 },
        uHighFreq: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uColor1: { value: new THREE.Color(0x1a0533) },
        uColor2: { value: new THREE.Color(0x6d28d9) },
        uColor3: { value: new THREE.Color(0xa78bfa) },
      },
      transparent: true,
    })
    
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.z = -5
    mesh.visible = false
    this.scene.add(mesh)
    this.effects.set('fluid', mesh)
    this.effectMaterials.set('fluid', material)
  }
  
  private initGeometryEffect() {
    const geometry = new THREE.IcosahedronGeometry(6, 4)
    const material = new THREE.ShaderMaterial({
      vertexShader: geometryVertexShader,
      fragmentShader: geometryFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBeatIntensity: { value: 0 },
        uLowFreq: { value: 0 },
        uMidFreq: { value: 0 },
        uHighFreq: { value: 0 },
        uAudioTexture: { value: this.audioDataTexture },
        uColor1: { value: new THREE.Color(0x4c1d95) },
        uColor2: { value: new THREE.Color(0x8b5cf6) },
        uColor3: { value: new THREE.Color(0xc4b5fd) },
        uWireframe: { value: 0 },
        uGlass: { value: 1 },
      },
      transparent: true,
      side: THREE.DoubleSide,
    })
    
    const mesh = new THREE.Mesh(geometry, material)
    mesh.visible = false
    this.scene.add(mesh)
    this.effects.set('geometry', mesh)
    this.effectMaterials.set('geometry', material)
  }
  
  private initNebulaEffect() {
    const geometry = new THREE.SphereGeometry(50, 32, 32)
    const material = new THREE.ShaderMaterial({
      vertexShader: nebulaVertexShader,
      fragmentShader: nebulaFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBeatIntensity: { value: 0 },
        uLowFreq: { value: 0 },
        uMidFreq: { value: 0 },
        uHighFreq: { value: 0 },
        uColor1: { value: new THREE.Color(0x0f0a1e) },
        uColor2: { value: new THREE.Color(0x6d28d9) },
        uColor3: { value: new THREE.Color(0xf472b6) },
        uCameraPos: { value: new THREE.Vector3() },
      },
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
    })
    
    const mesh = new THREE.Mesh(geometry, material)
    mesh.visible = false
    this.scene.add(mesh)
    this.effects.set('nebula', mesh)
    this.effectMaterials.set('nebula', material)
  }
  
  private initWaveformEffect() {
    const geometry = new THREE.PlaneGeometry(30, 10, 128, 64)
    const material = new THREE.ShaderMaterial({
      vertexShader: waveformVertexShader,
      fragmentShader: waveformFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBeatIntensity: { value: 0 },
        uLowFreq: { value: 0 },
        uMidFreq: { value: 0 },
        uHighFreq: { value: 0 },
        uAudioTexture: { value: this.audioDataTexture },
        uColor1: { value: new THREE.Color(0x1e1b4b) },
        uColor2: { value: new THREE.Color(0x6366f1) },
        uColor3: { value: new THREE.Color(0xa5b4fc) },
      },
      transparent: true,
      side: THREE.DoubleSide,
    })
    
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 4
    mesh.position.y = -2
    mesh.visible = false
    this.scene.add(mesh)
    this.effects.set('waveform', mesh)
    this.effectMaterials.set('waveform', material)
  }
  
  private createChromaticAberrationPass(): ShaderPass {
    const shader = {
      uniforms: {
        tDiffuse: { value: null },
        uAmount: { value: 0.002 },
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
        uniform float uAmount;
        varying vec2 vUv;
        
        void main() {
          vec2 dir = vUv - 0.5;
          float dist = length(dir);
          
          float r = texture2D(tDiffuse, vUv + dir * uAmount * dist).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, vUv - dir * uAmount * dist).b;
          
          gl_FragColor = vec4(r, g, b, 1.0);
        }
      `,
    }
    
    return new ShaderPass(shader)
  }
  
  setEffect(effect: VisualEffectType) {
    this.currentEffect = effect
    
    this.effects.forEach((obj, key) => {
      obj.visible = key === effect
    })
  }
  
  setColors(primary: string, secondary: string, accent: string) {
    this.primaryColor.set(primary)
    this.secondaryColor.set(secondary)
    this.accentColor.set(accent)
    
    this.effectMaterials.forEach((material) => {
      if (material.uniforms.uColor1) {
        material.uniforms.uColor1.value = this.primaryColor.clone().multiplyScalar(0.2)
      }
      if (material.uniforms.uColor2) {
        material.uniforms.uColor2.value = this.primaryColor.clone()
      }
      if (material.uniforms.uColor3) {
        material.uniforms.uColor3.value = this.accentColor.clone()
      }
    })
  }
  
  updateAudio(features: AudioFeatures) {
    const spectrum = features.spectrum
    
    for (let i = 0; i < 128; i++) {
      const idx = Math.floor(i * (spectrum.length / 128))
      const val = Math.max(0, Math.min(1, (spectrum[idx] + 100) / 100))
      this.audioDataArray[i] = Math.floor(val * 255)
    }
    this.audioDataTexture.needsUpdate = true
    
    this.effectMaterials.forEach((material) => {
      if (material.uniforms.uBeatIntensity) {
        material.uniforms.uBeatIntensity.value = features.beatIntensity
      }
      if (material.uniforms.uLowFreq) {
        material.uniforms.uLowFreq.value = features.lowFrequency
      }
      if (material.uniforms.uMidFreq) {
        material.uniforms.uMidFreq.value = features.midFrequency
      }
      if (material.uniforms.uHighFreq) {
        material.uniforms.uHighFreq.value = features.highFrequency
      }
    })
    
    this.bloomPass.strength = 0.8 + features.beatIntensity * 0.8
    this.chromaticAberrationPass.uniforms.uAmount.value = 0.001 + features.beatIntensity * 0.005
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
    
    this.effectMaterials.forEach((material) => {
      if (material.uniforms.uTime) {
        material.uniforms.uTime.value = time
      }
    })
    
    const particleObj = this.effects.get('particles')
    if (particleObj) {
      particleObj.rotation.y += delta * 0.1
      particleObj.rotation.x += delta * 0.05
    }
    
    const geoObj = this.effects.get('geometry')
    if (geoObj) {
      geoObj.rotation.y += delta * 0.3
      geoObj.rotation.x += delta * 0.1
    }
    
    const nebulaMat = this.effectMaterials.get('nebula')
    if (nebulaMat && nebulaMat.uniforms.uCameraPos) {
      nebulaMat.uniforms.uCameraPos.value.copy(this.camera.position)
    }
    
    this.camera.position.x = Math.sin(time * 0.1) * 2
    this.camera.position.y = Math.cos(time * 0.08) * 1.5
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
    
    const fluidMat = this.effectMaterials.get('fluid')
    if (fluidMat && fluidMat.uniforms.uResolution) {
      fluidMat.uniforms.uResolution.value.set(width, height)
    }
  }
  
  setQuality(quality: 'low' | 'medium' | 'high' | 'ultra') {
    this.quality = quality
    const particleObj = this.effects.get('particles')
    if (particleObj) {
      const mat = this.effectMaterials.get('particles')
      if (mat && mat.uniforms.uPointSize) {
        const sizeMap = { low: 0.5, medium: 0.75, high: 1.0, ultra: 1.5 }
        mat.uniforms.uPointSize.value = sizeMap[quality]
      }
    }
    
    this.bloomPass.strength = quality === 'ultra' ? 1.2 : quality === 'high' ? 1.0 : 0.7
    this.renderer.setPixelRatio(quality === 'ultra' ? 2 : quality === 'high' ? 1.5 : 1)
  }
  
  destroy() {
    this.pause()
    window.removeEventListener('resize', this.handleResize)
    
    this.effects.forEach((obj) => {
      this.scene.remove(obj)
    })
    
    this.effectMaterials.forEach((material) => {
      material.dispose()
    })
    
    this.audioDataTexture.dispose()
    this.renderer.dispose()
    this.composer.dispose()
    
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}

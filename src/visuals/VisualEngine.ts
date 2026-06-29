import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'
import type { AudioFeatures, VisualEffectType } from '@/types'

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
  
  private isPaused = false
  private quality: 'low' | 'medium' | 'high' | 'ultra' = 'high'
  
  // Lyrics particle system
  private particleSystem: THREE.Points | null = null
  private particleMaterial: THREE.ShaderMaterial | null = null
  private particleCount = 0
  
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
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
      0.6,
      0.4,
      0.85
    )
    this.composer.addPass(this.bloomPass)
    
    this.initLyricsParticles()
    
    window.addEventListener('resize', this.handleResize)
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
    
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      // Distribute particles in a wide area
      positions[i3] = (Math.random() - 0.5) * 40
      positions[i3 + 1] = (Math.random() - 0.5) * 30
      positions[i3 + 2] = (Math.random() - 0.5) * 20 - 5
      
      const hue = Math.random() * 0.3 + 0.6 // purple-blue range
      const color = new THREE.Color().setHSL(hue, 0.7, 0.5 + Math.random() * 0.3)
      colors[i3] = color.r
      colors[i3 + 1] = color.g
      colors[i3 + 2] = color.b
      
      sizes[i] = Math.random() * 1.5 + 0.3
      speeds[i] = Math.random() * 0.3 + 0.1
      phases[i] = Math.random() * Math.PI * 2
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1))
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1))
    
    const material = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float size;
        attribute float speed;
        attribute float phase;
        attribute vec3 customColor;
        
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
          
          // Gentle floating motion
          float t = uTime * speed + phase;
          pos.x += sin(t * 0.7) * 2.0;
          pos.y += cos(t * 0.5) * 1.5;
          pos.z += sin(t * 0.3) * 1.0;
          
          // Beat pulse - expand outward
          float beatPulse = uBeatIntensity * 3.0;
          vec3 dir = normalize(pos);
          pos += dir * beatPulse * sin(t * 2.0) * 0.5;
          
          // Low freq - vertical wave
          pos.y += sin(uTime * 0.8 + pos.x * 0.3) * uLowFreq * 2.0;
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          
          float dist = length(mvPosition.xyz);
          vAlpha = smoothstep(30.0, 10.0, dist) * (0.4 + uMidFreq * 0.3);
          
          gl_PointSize = size * uPointSize * (200.0 / -mvPosition.z);
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
  
  private getParticleCount(): number {
    const counts = { low: 1000, medium: 2500, high: 5000, ultra: 10000 }
    return counts[this.quality]
  }
  
  setEffect(_effect: VisualEffectType) {
    // Only one effect now
  }
  
  setColors(primary: string, secondary: string, accent: string) {
    this.primaryColor.set(primary)
    this.secondaryColor.set(secondary)
    this.accentColor.set(accent)
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
    
    // Subtle bloom, not too flashy
    this.bloomPass.strength = 0.4 + features.beatIntensity * 0.3
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
    
    if (this.particleMaterial) {
      this.particleMaterial.uniforms.uTime.value = time
    }
    
    if (this.particleSystem) {
      this.particleSystem.rotation.y += delta * 0.02
    }
    
    // Very subtle camera movement
    this.camera.position.x = Math.sin(time * 0.05) * 0.5
    this.camera.position.y = Math.cos(time * 0.04) * 0.3
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
    
    // Rebuild particles with new count
    if (this.particleSystem) {
      this.scene.remove(this.particleSystem)
      this.particleSystem.geometry.dispose()
      this.particleMaterial?.dispose()
    }
    this.initLyricsParticles()
    
    // Bloom and pixel ratio per quality
    const bloomStrength = { low: 0.2, medium: 0.4, high: 0.6, ultra: 0.8 }
    this.bloomPass.strength = bloomStrength[quality]
    
    const pixelRatios = { low: 0.5, medium: 1.0, high: 1.5, ultra: 2.0 }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatios[quality]))
  }
  
  destroy() {
    this.pause()
    window.removeEventListener('resize', this.handleResize)
    
    if (this.particleSystem) {
      this.scene.remove(this.particleSystem)
      this.particleSystem.geometry.dispose()
    }
    this.particleMaterial?.dispose()
    this.audioDataTexture.dispose()
    this.renderer.dispose()
    this.composer.dispose()
    
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}

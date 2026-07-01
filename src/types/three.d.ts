declare module 'three/examples/jsm/postprocessing/EffectComposer' {
  import * as THREE from 'three'

  export class EffectComposer {
    constructor(renderer: THREE.WebGLRenderer)
    addPass(pass: any): void
    setSize(width: number, height: number): void
    setPixelRatio(ratio: number): void
    render(deltaTime?: number): void
    dispose(): void
    passes: any[]
    renderTarget1: any
    renderTarget2: any
  }
}

declare module 'three/examples/jsm/postprocessing/RenderPass' {
  import * as THREE from 'three'

  export class RenderPass {
    constructor(scene: THREE.Scene, camera: THREE.Camera)
    enabled: boolean
    clear: boolean
  }
}

declare module 'three/examples/jsm/postprocessing/UnrealBloomPass' {
  import * as THREE from 'three'

  export class UnrealBloomPass {
    constructor(resolution: THREE.Vector2, strength: number, radius: number, threshold: number)
    strength: number
    radius: number
    threshold: number
    resolution: THREE.Vector2
    enabled: boolean
  }
}

declare module 'three/examples/jsm/postprocessing/ShaderPass' {
  export class ShaderPass {
    constructor(shader: any, textureID?: string)
    uniforms: any
    enabled: boolean
  }
}

declare module 'three/examples/jsm/postprocessing/FilmPass' {
  export class FilmPass {
    constructor(noiseIntensity?: number, scanlineIntensity?: number, scanlineCount?: number, grayscale?: boolean)
    uniforms: any
    enabled: boolean
  }
}

declare module 'three/examples/jsm/postprocessing/OutputPass' {
  export class OutputPass {
    constructor()
    enabled: boolean
  }
}

declare module 'three/examples/jsm/shaders/RGBShiftShader' {
  export const RGBShiftShader: {
    uniforms: { tDiffuse: { value: any }; amount: { value: number }; angle: { value: number } }
    vertexShader: string
    fragmentShader: string
  }
}

declare module 'three/examples/jsm/shaders/VignetteShader' {
  export const VignetteShader: {
    uniforms: { tDiffuse: { value: any }; offset: { value: number }; darkness: { value: number } }
    vertexShader: string
    fragmentShader: string
  }
}

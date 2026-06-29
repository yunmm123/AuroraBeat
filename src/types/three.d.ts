declare module 'three/examples/jsm/postprocessing/EffectComposer' {
  import * as THREE from 'three'
  
  export class EffectComposer {
    constructor(renderer: THREE.WebGLRenderer)
    addPass(pass: any): void
    setSize(width: number, height: number): void
    render(): void
    dispose(): void
    passes: any[]
  }
}

declare module 'three/examples/jsm/postprocessing/RenderPass' {
  import * as THREE from 'three'
  
  export class RenderPass {
    constructor(scene: THREE.Scene, camera: THREE.Camera)
    enabled: boolean
  }
}

declare module 'three/examples/jsm/postprocessing/UnrealBloomPass' {
  import * as THREE from 'three'
  
  export class UnrealBloomPass {
    constructor(resolution: THREE.Vector2, strength: number, radius: number, threshold: number)
    strength: number
    radius: number
    threshold: number
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

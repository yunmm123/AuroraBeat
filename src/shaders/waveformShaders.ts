export const waveformVertexShader = `
  uniform float uTime;
  uniform float uBeatIntensity;
  uniform float uLowFreq;
  uniform float uMidFreq;
  uniform float uHighFreq;
  uniform sampler2D uAudioTexture;
  
  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vNormal;
  
  void main() {
    vUv = uv;
    
    vec3 pos = position;
    
    float audioValue = texture2D(uAudioTexture, vec2(uv.x, 0.0)).r;
    float baseHeight = audioValue * 2.0 * (0.5 + uBeatIntensity * 0.5);
    
    float wave1 = sin(uv.x * 20.0 + uTime * 2.0) * uMidFreq * 0.5;
    float wave2 = sin(uv.x * 40.0 + uTime * 3.0 + 1.0) * uHighFreq * 0.3;
    float wave3 = sin(uv.x * 10.0 + uTime * 1.0 + 2.0) * uLowFreq * 0.8;
    
    float totalHeight = baseHeight + wave1 + wave2 + wave3;
    pos.y += totalHeight;
    
    vHeight = totalHeight;
    
    float eps = 0.01;
    float hL = texture2D(uAudioTexture, vec2(uv.x - eps, 0.0)).r * 2.0;
    float hR = texture2D(uAudioTexture, vec2(uv.x + eps, 0.0)).r * 2.0;
    vNormal = normalize(vec3(hL - hR, 2.0 * eps, 1.0));
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

export const waveformFragmentShader = `
  uniform float uTime;
  uniform float uBeatIntensity;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  
  varying vec2 vUv;
  varying float vHeight;
  varying vec3 vNormal;
  
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    
    float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.0);
    
    float heightFactor = clamp(vHeight / 3.0, 0.0, 1.0);
    
    vec3 color = mix(uColor1, uColor2, heightFactor);
    color = mix(color, uColor3, fresnel);
    
    float specular = pow(max(0.0, dot(reflect(-viewDir, normal), vec3(0.5, 1.0, 0.5))), 32.0);
    color += specular * uColor3 * uBeatIntensity;
    
    float bands = sin(vUv.x * 50.0 + uTime) * 0.05 + 0.95;
    color *= bands;
    
    float alpha = 0.6 + heightFactor * 0.4;
    alpha += fresnel * 0.3;
    
    float edgeAlpha = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
    alpha *= edgeAlpha;
    
    gl_FragColor = vec4(color, alpha);
  }
`

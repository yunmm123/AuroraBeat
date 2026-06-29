export const nebulaVertexShader = `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  
  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const nebulaFragmentShader = `
  uniform float uTime;
  uniform float uBeatIntensity;
  uniform float uLowFreq;
  uniform float uMidFreq;
  uniform float uHighFreq;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uCameraPos;
  
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float n000 = hash(i);
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));
    
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }
  
  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }
  
  void main() {
    vec3 dir = normalize(vWorldPosition - uCameraPos);
    vec3 rayPos = vWorldPosition * 0.02;
    
    float time = uTime * 0.1;
    
    vec3 nebulaPos = rayPos + vec3(time * 0.1, time * 0.05, -time * 0.08);
    
    float nebula = fbm(nebulaPos * 2.0 + uLowFreq);
    float detail = fbm(nebulaPos * 5.0 + uMidFreq) * 0.5;
    nebula = nebula * 0.7 + detail * 0.3;
    
    float coreDist = length(rayPos - vec3(0.0, 0.0, 0.0));
    float core = smoothstep(3.0, 0.0, coreDist) * uLowFreq;
    nebula += core * 0.5;
    
    nebula += uBeatIntensity * 0.2;
    
    vec3 color = mix(uColor1, uColor2, smoothstep(0.2, 0.5, nebula));
    color = mix(color, uColor3, smoothstep(0.4, 0.8, nebula));
    
    float stars = hash(floor(rayPos * 100.0));
    stars = pow(stars, 20.0) * uHighFreq * 2.0;
    color += vec3(stars);
    
    float twinkle = sin(uTime * 3.0 + rayPos.x * 50.0) * 0.5 + 0.5;
    stars *= twinkle;
    
    float alpha = smoothstep(0.1, 0.6, nebula) * 0.8;
    alpha += stars;
    
    float vignette = 1.0 - smoothstep(0.3, 0.8, length(vUv - 0.5));
    alpha *= vignette;
    
    gl_FragColor = vec4(color, alpha);
  }
`

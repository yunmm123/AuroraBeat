export const fluidVertexShader = `
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const fluidFragmentShader = `
  uniform float uTime;
  uniform float uBeatIntensity;
  uniform float uLowFreq;
  uniform float uMidFreq;
  uniform float uHighFreq;
  uniform vec2 uResolution;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  
  varying vec2 vUv;
  
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    
    for (int i = 0; i < 6; i++) {
      value += amplitude * noise(p * frequency);
      amplitude *= 0.5;
      frequency *= 2.0;
    }
    return value;
  }
  
  void main() {
    vec2 uv = vUv;
    vec2 center = uv - 0.5;
    
    float aspect = uResolution.x / uResolution.y;
    center.x *= aspect;
    
    float time = uTime * 0.3;
    
    vec2 flow = vec2(
      fbm(center * 3.0 + time * 0.5 + uLowFreq * 2.0),
      fbm(center * 3.0 + time * 0.3 + 100.0 + uMidFreq * 2.0)
    );
    flow = (flow - 0.5) * 0.5;
    
    vec2 distortedUv = center + flow * (1.0 + uBeatIntensity);
    
    float dist = length(distortedUv);
    
    float fluid1 = fbm(distortedUv * 4.0 + time + uLowFreq);
    float fluid2 = fbm(distortedUv * 6.0 - time * 0.7 + uMidFreq);
    float fluid3 = fbm(distortedUv * 8.0 + time * 1.2 + uHighFreq);
    
    float combined = fluid1 * 0.5 + fluid2 * 0.3 + fluid3 * 0.2;
    combined += uBeatIntensity * 0.3;
    
    vec3 color = mix(uColor1, uColor2, smoothstep(0.3, 0.6, combined));
    color = mix(color, uColor3, smoothstep(0.5, 0.8, combined));
    
    float rim = smoothstep(0.8, 0.2, dist);
    color *= 0.7 + rim * 0.5;
    
    float highlight = pow(max(0.0, 1.0 - dist * 1.5), 2.0);
    color += uColor3 * highlight * uHighFreq * 0.5;
    
    float vignette = 1.0 - smoothstep(0.6, 1.2, dist);
    color *= vignette;
    
    float alpha = smoothstep(0.2, 0.7, combined) * 0.8 + 0.2;
    alpha *= vignette;
    
    gl_FragColor = vec4(color, alpha);
  }
`

export const geometryVertexShader = `
  uniform float uTime;
  uniform float uBeatIntensity;
  uniform float uLowFreq;
  uniform float uMidFreq;
  uniform float uHighFreq;
  uniform sampler2D uAudioTexture;
  
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vDisplacement;
  
  void main() {
    vNormal = normal;
    vPosition = position;
    
    vec3 pos = position;
    
    float audioValue = 0.0;
    float audioIndex = abs(normal.x + normal.y + normal.z) * 0.333;
    audioValue = texture2D(uAudioTexture, vec2(audioIndex, 0.0)).r;
    
    float displacement = audioValue * uBeatIntensity * 2.0;
    displacement += sin(uTime * 2.0 + position.x * 2.0) * uMidFreq * 0.5;
    displacement += cos(uTime * 1.5 + position.y * 3.0) * uHighFreq * 0.3;
    displacement += sin(uTime + position.z * 1.5) * uLowFreq * 0.8;
    
    pos += normal * displacement;
    vDisplacement = displacement;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

export const geometryFragmentShader = `
  uniform float uTime;
  uniform float uBeatIntensity;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform float uWireframe;
  uniform float uGlass;
  
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vDisplacement;
  
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vPosition);
    
    float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.0);
    
    float displacementFactor = clamp(vDisplacement, 0.0, 1.0);
    
    vec3 color = mix(uColor1, uColor2, displacementFactor);
    color = mix(color, uColor3, fresnel);
    
    if (uWireframe > 0.5) {
      float edge = max(
        abs(dFdx(gl_FragCoord.z)) + abs(dFdy(gl_FragCoord.z)),
        0.0
      );
      edge = smoothstep(0.0, 0.02, edge);
      color = mix(color, uColor3, edge);
      float alpha = edge * 0.9 + 0.1;
      gl_FragColor = vec4(color, alpha);
    } else if (uGlass > 0.5) {
      color += fresnel * uColor3 * 0.5;
      float alpha = 0.3 + fresnel * 0.4 + uBeatIntensity * 0.2;
      gl_FragColor = vec4(color, alpha);
    } else {
      float light = max(0.3, dot(normal, vec3(0.5, 1.0, 0.5)));
      color *= light;
      color += fresnel * uColor3 * 0.3;
      gl_FragColor = vec4(color, 1.0);
    }
  }
`

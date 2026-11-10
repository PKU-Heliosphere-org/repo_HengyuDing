import * as THREE from "three";
import type { BodyId, PlanetState, Vec3 } from "./types";
export const AU_KM = 149597870.7;
const vertex = `
  varying vec2 vUv;
  varying vec3 vBodyNormal;
  uniform vec3 uAxisScale;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){
    vUv=uv;vBodyNormal=normalize(normal/uAxisScale);
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
    #include <logdepthbuf_vertex>
  }
`;
const fragment = `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uSunLocal;
  uniform bool uEarth;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vBodyNormal;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    float n=dot(normalize(vBodyNormal),normalize(uSunLocal));
    float day=smoothstep(-0.10,0.10,n);
    vec3 albedo=texture2D(uDay,vUv).rgb;
    vec3 result;
    if(uEarth){
      vec3 night=texture2D(uNight,vUv).rgb*1.7;
      result=mix(night,albedo*(0.09+0.91*max(n,0.0)),day);
    } else {
      float diffuse=0.025+0.975*day*max(n,0.035);
      result=albedo*diffuse;
    }
    gl_FragColor=vec4(result,uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function textureRepository(
  invalidate: () => void,
  onError: (message: string) => void,
) {
  const textures = new Map<string, THREE.Texture>();
  const loader = new THREE.TextureLoader();
  return {
    get(name: string) {
      let texture = textures.get(name);
      if (!texture) {
        texture = loader.load(
          "/textures/" + name,
          () => invalidate(),
          undefined,
          () => onError("无法加载纹理：" + name),
        );
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        textures.set(name, texture);
      }
      return texture;
    },
    dispose() {
      textures.forEach((t) => t.dispose());
      textures.clear();
    },
  };
}
export type TextureRepository = ReturnType<typeof textureRepository>;

export class PlanetVisual {
  root = new THREE.Group();
  body = new THREE.Group();
  surface: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  glow: THREE.Sprite;
  meridian: THREE.Line;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial> | null = null;
  radiusKm = 1;
  constructor(
    public id: BodyId,
    color: string,
    repository: TextureRepository,
    glowMap: THREE.Texture,
  ) {
    const day = repository.get(id === "earth" ? "earth_day.jpg" : id + ".jpg");
    const night = id === "earth" ? repository.get("earth_night.jpg") : day;
    const geometry = new THREE.SphereGeometry(1, 96, 64).rotateX(Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: true,
      uniforms: {
        uDay: { value: day },
        uNight: { value: night },
        uSunLocal: { value: new THREE.Vector3(1, 0, 0) },
        uEarth: { value: id === "earth" },
        uOpacity: { value: 1 },
        uAxisScale: { value: new THREE.Vector3(1, 1, 1) },
      },
    });
    this.surface = new THREE.Mesh(geometry, material);
    this.body.add(this.surface);
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap,
        color,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        sizeAttenuation: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.scale.setScalar(0.011);
    this.root.add(this.glow, this.body);
    const linePoints = Array.from({ length: 181 }, (_, i) => {
      const lat = -Math.PI / 2 + (i * Math.PI) / 180;
      return new THREE.Vector3(Math.cos(lat) * 1.003, 0, Math.sin(lat) * 1.003);
    });
    this.meridian = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(linePoints),
      new THREE.LineBasicMaterial({
        color: "#f3d38e",
        transparent: true,
        opacity: 0.75,
      }),
    );
    this.body.add(this.meridian);
    if (id === "saturn") {
      const inner = 66900 / 60268,
        outer = 140220 / 60268;
      const rg = new THREE.RingGeometry(inner, outer, 160);
      const positions = rg.attributes.position,
        uvs = rg.attributes.uv;
      for (let i = 0; i < positions.count; i++)
        uvs.setXY(
          i,
          (Math.hypot(positions.getX(i), positions.getY(i)) - inner) /
            (outer - inner),
          0.5,
        );
      const ringMaterial = new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        vertexShader: `varying vec2 vUv;varying vec3 vBodyPosition;\n#include <common>\n#include <logdepthbuf_pars_vertex>\nvoid main(){vUv=uv;vBodyPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);\n#include <logdepthbuf_vertex>\n}`,
        fragmentShader: `uniform sampler2D uMap;uniform vec3 uSunLocal;uniform float uOpacity;varying vec2 vUv;varying vec3 vBodyPosition;\n#include <logdepthbuf_pars_fragment>\nvoid main(){\n#include <logdepthbuf_fragment>\nvec4 c=texture2D(uMap,vUv);vec3 d=normalize(uSunLocal);float along=-dot(vBodyPosition,d);float shadow=along>0.&&length(vBodyPosition+along*d)<1.?0.10:1.;c.rgb*=shadow*(.15+.85*abs(d.z));gl_FragColor=vec4(c.rgb,c.a*uOpacity);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
        uniforms: {
          uMap: { value: repository.get("saturn_ring.png") },
          uSunLocal: { value: new THREE.Vector3(1, 0, 0) },
          uOpacity: { value: 1 },
        },
      });
      this.ring = new THREE.Mesh(rg, ringMaterial);
      this.body.add(this.ring);
    }
  }
  update(
    state: PlanetState,
    sun: Vec3,
    camera: THREE.PerspectiveCamera,
    height: number,
    showMeridian: boolean,
  ) {
    this.root.position.fromArray(state.position).divideScalar(AU_KM);
    this.body.quaternion.fromArray(state.quaternion);
    this.body.scale.fromArray(state.radii).divideScalar(AU_KM);
    this.radiusKm = Math.max(...state.radii);
    const sunLocal = new THREE.Vector3()
      .fromArray(sun)
      .sub(new THREE.Vector3().fromArray(state.position))
      .applyQuaternion(this.body.quaternion.clone().invert())
      .normalize();
    this.surface.material.uniforms.uSunLocal.value.copy(sunLocal);
    this.surface.material.uniforms.uAxisScale.value.set(
      state.radii[0] / this.radiusKm,
      state.radii[1] / this.radiusKm,
      state.radii[2] / this.radiusKm,
    );
    const distance = camera.position.distanceTo(this.root.position);
    const pixels =
      (height * (this.radiusKm / AU_KM)) /
      (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
        Math.max(distance, 1e-14));
    this.glow.position
      .copy(camera.position)
      .sub(this.root.position)
      .setLength((this.radiusKm / AU_KM) * 1.02);
    const blend = THREE.MathUtils.smoothstep(pixels, 3, 20);
    this.surface.visible = blend > 0.001;
    this.surface.material.uniforms.uOpacity.value = blend;
    this.glow.visible = blend < 0.999;
    this.glow.material.opacity = (1 - blend) * 0.9;
    this.meridian.visible = showMeridian && this.id === "earth" && blend > 0.5;
    if (this.ring) {
      this.ring.visible = blend > 0.001;
      this.ring.material.uniforms.uOpacity.value = blend;
      this.ring.material.uniforms.uSunLocal.value.copy(sunLocal);
    }
    return blend > 0.5 ? "surface" : "glow";
  }
  dispose() {
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material)
        (Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        ).forEach((m) => m.dispose());
    });
  }
}

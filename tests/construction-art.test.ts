import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {AssetBuilder} from '../src/render/assets/AssetBuilder';
import {BROWSER_CATALOGUE} from '../src/dev/architectureBrowserModel';
import {CONSTRUCTION_ART_CASES,constructionArtConfig} from '../src/dev/constructionArtCases';
import {STRUCTURE_ART,ERA_CRAFT,surfaceArtLayout,surfacePanel,surfaceTileRect,ARTWORK_WIDTH} from '../src/render/architecture/SurfaceArtPrograms';
import {BUILDING_ARCHETYPES} from '../src/render/architecture/BuildingArchetype';
import {ARCHITECTURAL_PERIODS} from '../src/render/architecture/ArchitecturalPeriod';
import {facadeArtwork} from '../src/render/architecture/FacadeSvg';
import type {FacadePlan} from '../src/render/architecture/FacadePlan';
import {projectSurfaceCoordinates} from '../src/render/architecture/FacadeTextures';

describe('construction artwork production coverage',()=>{
  it('requires an explicit composition for all 23 archetypes and craft rules for every era',()=>{
    expect(Object.keys(STRUCTURE_ART)).toEqual([...BUILDING_ARCHETYPES]);
    expect(Object.keys(ERA_CRAFT)).toEqual([...ARCHITECTURAL_PERIODS]);
    expect(new Set(Object.values(STRUCTURE_ART).map(p=>p.name)).size).toBe(23);
    expect(STRUCTURE_ART.house.boards).not.toBe(STRUCTURE_ART.stable.boards);
    expect(ERA_CRAFT.bronzeIron.stone).not.toBe(ERA_CRAFT.medieval.stone);
    expect(ERA_CRAFT.industrial.joints).toBe('rivet');
  });
  for(const entry of BROWSER_CATALOGUE) it(`binds actual ${entry.id} geometry across every period and valid evidence scenario`,()=>{
    const cases=CONSTRUCTION_ART_CASES.filter(c=>c.archetype===entry.id);
    expect(cases.length).toBeGreaterThan(0);
    for(const c of cases){
      const builder=new AssetBuilder('art-test');
      try{
        const root=builder.getAsset('building',constructionArtConfig(entry,c.period,c.scenario)).mesh;
        const plan=root.userData['facadePlan'] as FacadePlan;
        expect(plan,c.id).toBeDefined();
        expect(plan.spec.period,c.id).toBe(c.period);
        const cells=surfaceArtLayout(plan);
        expect(cells.every(cell=>cell.program.includes(`/${entry.id}/${c.period}/${cell.material}/`))).toBe(true);
        for(const cell of cells){
          expect(cell.x+cell.width).toBeLessThan(ARTWORK_WIDTH);
          expect(cell.y+cell.height).toBeLessThan(1024);
        }
        let painted=0,invalid=0;
        const full=root instanceof THREE.LOD?root.levels[0]!.object:root;
        full.traverse(object=>{
          if(!(object instanceof THREE.Mesh))return;
          // Opening-aligned elevation coordinates, or the material's physical tile coordinates.
          const uv=object.geometry.getAttribute('aFacadeUv'),tile=object.geometry.getAttribute('aFacadeTile');
          if(uv)for(let i=0;i<uv.count;i++){
            if(!Number.isFinite(uv.getX(i)) || !Number.isFinite(uv.getY(i)))invalid++;
            if(uv.getZ(i)>0)painted++;
          }
          if(tile)for(let i=0;i<tile.count;i++){
            if(!Number.isFinite(tile.getX(i)) || !Number.isFinite(tile.getY(i)) || !Number.isFinite(tile.getZ(i)))invalid++;
            painted++;
          }
        });
        expect(painted,c.id).toBeGreaterThan(0);
        expect(invalid,c.id).toBe(0);
        expect(builder.facadeTextures.stats().budgetFallbacks).toBe(0);
      }finally{builder.dispose();}
    }
  });
  it('keeps paired layers deterministic, differentiates timber functions, and has no four-atlas limit',()=>{
    const builder=new AssetBuilder('art-pressure');
    try{
      const house=BROWSER_CATALOGUE.find(e=>e.id==='house')!;
      const plans=[];
      for(let i=0;i<20;i++){
        const config=constructionArtConfig(house,'medieval','timber');config.seed=`art-pressure-${i}`;
        plans.push(builder.getAsset('building',config).mesh.userData['facadePlan'] as FacadePlan);
        const stats=builder.facadeTextures.stats();
        expect(stats.estimatedGpuBytes).toBeLessThanOrEqual(stats.budgetBytes);
      }
      expect(builder.facadeTextures.stats().entries).toBe(20);
      const plan=plans[0]!,cell=surfaceArtLayout(plan).find(c=>c.material===plan.materials.wall)!;
      const albedo=surfacePanel(plan,cell,'albedo');
      expect(albedo).toBe(surfacePanel(plan,cell,'albedo'));
      expect(albedo).not.toBe(surfacePanel(plan,cell,'relief'));
      expect(albedo).not.toMatch(/NaN|Infinity|<script|<image/);
      const art=facadeArtwork(plan);
      expect(art.albedo).toContain('width="2048"');
      expect(art.albedo).not.toBe(art.relief);
    }finally{builder.dispose();}
  });
  it('paints seamless, physically scaled material tiles that differ per building but not per call',()=>{
    const builder=new AssetBuilder('art-tiles');
    try{
      const factory=BROWSER_CATALOGUE.find(e=>e.id==='factory')!;
      const plan=(seed:string)=>{const config=constructionArtConfig(factory,'industrial','brick');config.seed=seed;
        const root=builder.getAsset('building',config).mesh;return (root instanceof THREE.LOD?root.levels[0]!.object:root).userData['facadePlan'] as FacadePlan;};
      const a=plan('tiles-a'),b=plan('tiles-b');
      const brick=surfaceArtLayout(a).find(c=>c.material==='fired-brick')!;
      // Twelve 75 mm courses at one canonical unit per six metres.
      expect(brick.tile).toBeCloseTo(.15,5);
      expect(brick.x).toBeGreaterThanOrEqual(1024);
      const [u,v,w,h]=surfaceTileRect(brick);
      expect(u).toBeGreaterThan(.5);expect(u+w).toBeLessThanOrEqual(1);expect(v).toBeGreaterThanOrEqual(0);expect(v+h).toBeLessThanOrEqual(1);
      const panel=surfacePanel(a,brick,'albedo');
      expect(panel).toBe(surfacePanel(a,brick,'albedo'));
      // Ground (mortar) and units are separate groups, each wrapped into all nine neighbours.
      expect(panel.match(/<use href="#/g)).toHaveLength(18);
      const other=surfaceArtLayout(b).find(c=>c.material==='fired-brick')!;
      expect(surfacePanel(b,other,'albedo')).not.toBe(panel);
      expect(surfaceArtLayout(a).every(c=>c.width===c.height&&c.pad>0)).toBe(true);
      const art=facadeArtwork(a);
      expect(art.mask).toContain('width="2048"');
      expect(art.openings).toContain('width="2048"');
      expect(art.relief).toContain('feGaussianBlur');
    }finally{builder.dispose();}
  });
  it('turns timber tiles so grain follows each member, and gives every non-glass surface tile coordinates',()=>{
    const builder=new AssetBuilder('art-grain');
    try{
      const house=BROWSER_CATALOGUE.find(e=>e.id==='house')!;
      const root=builder.getAsset('building',constructionArtConfig(house,'medieval','timber')).mesh;
      const full=root instanceof THREE.LOD?root.levels[0]!.object:root;
      let tiled=0;
      full.traverse(object=>{
        if(!(object instanceof THREE.Mesh))return;
        const tile=object.geometry.getAttribute('aFacadeTile');
        if(tile){tiled++;expect(object.material.name,object.name).toContain(':svg-facade');}
      });
      expect(tiled).toBeGreaterThan(3);
      const plan=full.userData['facadePlan'] as FacadePlan;
      expect(surfaceArtLayout(plan).some(c=>c.material==='heavy-timber')).toBe(true);
      expect(surfaceArtLayout(plan).every(c=>c.program.startsWith('construction-v2/house/medieval/'))).toBe(true);
      // A post: a tall box whose grain axis is vertical. Along its front face the tile's grain
      // coordinate (u) must change with height, not with width.
      const post=new THREE.BoxGeometry(.02,.4,.02).toNonIndexed();
      const count=post.getAttribute('position').count;
      post.setAttribute('aSurfaceDetail',new THREE.Int8BufferAttribute(new Int8Array(count*4).map((_,i)=>i%4===2?63:0),4,true));
      projectSurfaceCoordinates(post,plan,'heavy-timber');
      const pos=post.getAttribute('position'),nrm=post.getAttribute('normal'),tile=post.getAttribute('aFacadeTile');
      const front=[...Array(count).keys()].filter(i=>nrm.getZ(i)>.9);
      const top=front.filter(i=>pos.getY(i)>0),bottom=front.filter(i=>pos.getY(i)<0);
      expect(Math.abs(tile.getX(top[0]!)-tile.getX(bottom[0]!))).toBeCloseTo(.4,4);
    }finally{builder.dispose();}
  });
});

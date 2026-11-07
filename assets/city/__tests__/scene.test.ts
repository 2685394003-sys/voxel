import { describe, expect, it } from 'vitest';
import { BULLET_POOL_SIZE, FACILITY_PLACEMENTS, FACILITY_TYPES, TURRET } from '../facility-config.ts';
import scenePack from '../scene.pack.ts';

interface SceneEntityShape {
  readonly components: Record<string, Record<string, unknown>>;
}

async function buildScene(): Promise<Record<string, SceneEntityShape>> {
  // 无参数包也要显式传 reader，与引擎的调用方式保持一致。
  const built = await scenePack.build(undefined as never);
  if (built === null || typeof built !== 'object' || built.ok !== true) {
    throw new Error(`city 场景构建失败：${JSON.stringify(built)}`);
  }
  const scene = (built as unknown as { value: Record<string, { entities: Record<string, SceneEntityShape> }> })
    .value['scene/city'];
  if (scene === undefined) throw new Error('city 场景缺少 scene/city 资产');
  return scene.entities;
}

describe('city 场景编排', () => {
  it('13 个设施全部在位，且尺寸与配置表一致', async () => {
    const entities = await buildScene();
    expect(FACILITY_PLACEMENTS).toHaveLength(13);
    for (const placement of FACILITY_PLACEMENTS) {
      const entity = entities[`facility/${placement.type}`];
      expect(entity, `缺少设施 ${placement.type}`).toBeDefined();
      const type = FACILITY_TYPES[placement.type];
      const transform = entity!.components.Transform as {
        readonly pos: readonly number[];
        readonly scale: readonly number[];
      };
      expect(transform.scale).toEqual([...type.size]);
      // 体块底面贴地：pos.y 应为高度的一半
      expect(transform.pos[1]).toBeCloseTo(type.size[1] / 2, 5);
      expect(transform.pos[0]).toBe(placement.x);
      expect(transform.pos[2]).toBe(placement.z);
    }
  });

  it('战舰、炮塔、炮管、瞄准点、子弹池、相机与光照都编排好了', async () => {
    const entities = await buildScene();
    for (const key of ['ship', 'turret', 'barrel', 'aim', 'camera', 'sun', 'skylight', 'sky-background']) {
      expect(entities[key], `缺少实体 ${key}`).toBeDefined();
    }
    for (let index = 0; index < BULLET_POOL_SIZE; index += 1) {
      expect(entities[`bullet/${index}`]).toBeDefined();
    }
  });

  it('炮管挂在炮塔下，位置取自同一份炮塔配置', async () => {
    const entities = await buildScene();
    const barrel = entities.barrel!;
    expect(barrel.components.ChildOf).toEqual({ parent: 'turret' });
    const transform = barrel.components.Transform as { readonly pos: readonly number[] };
    expect(transform.pos[2]).toBe(TURRET.barrelZ);
  });

  it('子弹初始停在画面外的冷宫高度，不会一开局就出现在江面上', async () => {
    const entities = await buildScene();
    const bullet = entities['bullet/0']!;
    const transform = bullet.components.Transform as { readonly pos: readonly number[] };
    expect(transform.pos[1]).toBeLessThan(-100);
  });
});

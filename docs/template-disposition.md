# game-3d 模板处置记录（Template Disposition）

> 建立时间：M0 灰盒验收通过时。维护者：接手本工程的任何 AI / 程序员。

## 为什么必须有这份记录

SDK 的硬规定（`engine-sdk-0.4.19/skills/forgeax-engine-sdk/SDK-README.md` 第 50–52 行）：

> game-3d is a content-bearing reference, not production artwork. Original/high-fidelity games replace
> visible content and forge.json/package/GUID/sourceKey/plugin identity, while reusing runtime code according to
> Template Disposition.

也就是说 `game-3d` 模板自带一整套**可运行但与本作无关**的样例（骑士、花瓶、示例场景、3C 引导 UI）。
「把样例文件留在 `assets/` 里」和「把样例装进游戏里」是两件不同的事，而这两件事**看起来一模一样**——
所以必须写下来，否则下一个接手的人无法分辨某个文件是「模板样例」还是「本作内容」，会照着它改。

> 上游规范链接（AGENTS.md 指向的 `game-project-guide.md#game-3d-template-disposition`）在本机网络下返回 404，
> 仓库不可达。本记录按上面那一句原文 + SDK 模板自身注释落实为「身份 / 可见内容 / 运行期代码」三张表。

---

## 一、身份（Identity）

| 项目 | 模板原值 | 本作现值 | 位置 |
|:--|:--|:--|:--|
| 项目 id | `game-3d` | `voxel-warship` | `forge.json#id` |
| 显示名 | Game 3D | Voxel Warship | `forge.json#name` |
| 包名 | `@forgeax/template-game-3d` | `@local/voxel-warship` | `package.json#name` |
| `roots.frontend` | 指向模板的 UI 插件 | `eba035f8-b41f-5c1d-b2cd-8167832fa370` → `hud/plugin/hud` | `forge.json#roots` |
| 新增包 identity | — | `019fb7ce-5000-…`（scene）/ `5100-…`（plugin）/ `5200-…`（hud） | `assets/city/pack-ids.ts` |
| 新增插件名 | — | `voxel-warship/city`、`/warship`、`/camera`、`/hud` | 各插件 `name` 字段 |
| 新增资源 sourceKey | — | `mesh/voxel-warship:*`、`material/*`、`scene/city`、`plugin/city` | 各 `.pack.ts` |

**`roots.engine` 与 `assets/game.pack.ts` 的包身份（`019fb7ce-3800-…`）有意沿用模板原值。**
理由：合成根只承载一个 `children` 列表，不含任何可见内容；改它要同步改 `forge.json#roots.engine`，
收益是零（玩家看不到），风险是整条装配链失效。新增的三个包使用全新的 `5x00` UUID 段，
与模板原有段（`3800` / `3e00` 等）完全不相交，不会撞号。

---

## 二、可见内容（Visible content）

模板样例内容**全部未装配**（不在任何运行时装配链上），文件按「保留作参考 / 待删」分别标注。

| 模板内容 | 体积 | 处置 | 现状 |
|:--|--:|:--|:--|
| `assets/scene.pack.ts`（示例场景：骑士、台阶、圆环、点光源） | 12K | 不装配 | 文件在，`plugin/scene` 未挂载 |
| `assets/character.pack.ts`（带骨骼行走动画的骑士） | 20K | 不装配 | 文件在 |
| `assets/fantasy-meshes.pack.ts` | 12K | 不装配 | 文件在 |
| `assets/uv-primitives.pack.ts` | 8K | 不装配 | 文件在，仍被 `starter.test.ts` 断言 |
| `assets/runtime-vase/`（花瓶程序化生成示例） | 33K | 不装配 | 文件在，`plugin/host` `plugin/player` `plugin/camera` `plugin/scene` 的注册项仍在 pack 内 |
| `assets/player/`（第一人称 / 触屏玩家控制器） | 52K | 不装配 | 文件在 |
| `assets/camera/`（模板第三人称相机插件） | 20K | 不装配 | 文件在；本作用 `assets/city/camera.ts` 另写 |
| `assets/ui/`（UI 导入管线样例） | 36K | 不装配 | 文件在 |
| `assets/guide.ui.html` / `.css` / `.i18n.json` / `.meta.json`（3C 操作引导） | 4K+ | 不装配 | 文件在 |
| `materials.pack.ts` / `geometry.pack.ts` 内的模板条目 | — | **保留并追加** | 原有条目一字未改，本作资源以新 key 追加在后 |

**本作新增的可见内容**（这些才是本作的，别当样例删）：

| 内容 | 位置 |
|:--|:--|
| 800×800 上海地图 + 黄浦江航道 + 两岸防汛墙 | `assets/city/scene.pack.ts` |
| 13 个设施体块、战舰、炮塔、炮管、瞄准环、12 发弹药池 | 同上 + `assets/geometry.pack.ts` |
| 地面 / 水面 / 四档设施色调 / 船体 / 弹药 / 瞄准环材质 | `assets/materials.pack.ts` |
| 全部可调数值（地图、设施、船、炮、弹道、相机） | `assets/city/facility-config.ts`（唯一调参面） |
| HUD（计时 / 已摧毁 / 军费 / 四格装载池） | `assets/hud/hud-controller.ts` |

### 一处已废弃并已删除的路径

HUD 最初按模板的 UI 导入管线写（`assets/hud/hud.ui.html` + `.css` + `.html.meta.json`），
但该资源始终无法进入运行时 Catalog（`dev start` 报 `asset-package-invalid`，`reason: publication generation`，
`asset import` 返回 `reused: true` 而 DDC 无对应行）。放弃该路径后 HUD 改为前端领域直接建 DOM，
三个 `.ui.*` 文件与 `pack-ids.ts#HUD_UI_GUID` 常量已一并删除——留着一个「不在 Catalog 里的资产身份」
等于给下一个人埋雷：谁再 import 一次就会重新触发同一条报错。

---

## 三、运行期代码（Runtime code：按规范「复用」）

| 复用的模板能力 | 本作如何使用 |
|:--|:--|
| Cordis 插件模型 + `ctx.effect(function*(){})` 清理语义 | `city.pack.ts` / `warship.ts` / `camera.ts` / `hud.pack.ts` 全部照此写，`yield` 即销毁器 |
| ECS：`Update` / `FixedUpdate` 双时钟、`addSystem` 的 `after/before/queries` | 三段系统：`-aim`（Update 采样输入）/ `-sim`（FixedUpdate 判定）/ `-present`（Update 写 Transform） |
| 读投影 `host.gameProjection.registerRead` | 注册 `voxel-warship.state`，验收脚本**只**通过它断言 |
| DevKit `project play` + `playthrough.mjs` 骨架 | 改写为 R1–R5，一个需求一张命名截图 |
| `definePack` / `definePackageId` / `AssetGuid.derive` 的 GUID 纪律 | 见上表「新增包 identity」；GUID 一律由包 ID + sourceKey 推导，不手写 |
| vitest 测试脚手架 | 沿用；新增 `assets/city/__tests__/`（20 项） |

**测试处置（重要）**：`assets/__tests__/starter.test.ts` 里三条断言写死了模板样例的数量
（材质 15 条、网格 8 条、frontend root 指向模板 UI）。模板注释明确允许改写这类「样例专属断言」，
已改为 `expect.arrayContaining([...])` 并补一条「`plugin/engine` 的 children 必须包含 `plugin/city`」的断言——
从「数量对不对」变成「本作的东西有没有接上」。

---

## 四、有意保留的模板样例代码（不是遗漏）

上面第二张表里标「文件在」的那批（约 200K）仍然参与 `pnpm typecheck` 与 `pnpm test`。
保留理由：

1. 它们是**引擎能力的可运行参考**（骨骼动画、UI 导入、程序化网格、触屏输入）。遇到 SDK 用法疑问时，
   一份能跑通、能断点的样例比读文档快。
2. 删它们不是「删几个文件」那么简单：`assets/player/__tests__/`、`camera/__tests__/`、`ui/__tests__/`、
   `runtime-vase/__tests__/`、`temporal-alignment`、`plugin-cleanup`、`plugin-dependencies` 全都挂在上面。
   **只删样例不删测试 ⇒ `pnpm test` 立刻变红。** 要删就必须样例和测试成对删。

所以清理是一件事后任务，不是顺手能干的活。判断标准很简单：
**看 `assets/game.pack.ts` 的 `children`。** 不在那条链上的东西，运行时就不存在。

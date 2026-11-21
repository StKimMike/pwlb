# 保卫萝卜（复刻）· 集成契约 v2

> v2 相对 v1 的变化：多格建筑、炮塔攻击策略、更多怪物、购买制道具、画风重制。
> 实现必须严格遵守本文件；改契约先改本文件。

## 0. 坐标与画布（不变）

- 逻辑分辨率 1280×768，20 列 × 12 行，每格 64px。
- 格子 (col,row) 中心像素 `x=(col+0.5)*64, y=(row+0.5)*64`。

## 1. 障碍 / 建筑（v2 重点：可占多格、需要炮塔打）

levels.json 的 `obstacles` 每项新增 `w`、`h`（占用格数，1..3）：

```json
{"kind":"rock","col":8,"row":7,"w":2,"h":2,"hp":420,"reward":160,
 "blockTower":true}
```

- `col,row` 是**左上角**格子；占 `w×h` 格。
- `blockTower`: true 时这些格子都不能建塔（拆掉后可以）。
- 建筑**必须有和怪物一样的血条**（常驻显示在建筑顶部，宽度按 w 缩放）。
- 只能被炮塔的攻击打掉（溅射 / 穿透 / 激光都算），点击只弹出「拆除」面板。
- `kind` 取值扩展为：`rock` `mushroom` `crate` `crystal` `tree` `house` `fence` `tower_rubble`
- `hp` 按 64px² 一格折算，多格建筑血量要明显更高。

## 2. 炮塔（v2 重点：攻击策略多样）

towers.json 每项的 `levels` 里新增策略字段（缺省为 0/false）：

```json
{
  "damage": 20, "range": 150, "cooldown": 0.9, "projSpeed": 500,
  "splash": 0, "slowPct": 0, "slowDur": 0, "chain": 0, "beamDps": 0,
  "shots": 1, "spread": 0, "chainRange": 0,

  "strategy": "single",
  "pierce": 0,
  "poison": 0,
  "poisonDur": 0,
  "critChance": 0,
  "critMult": 2,
  "homing": false,
  "multiShotAngle": 0,
  "burst": 0,
  "auraRadius": 0,
  "auraBuff": 0
}
```

`strategy` 取值（实现必须全部支持）：
- `single` 单体追踪弹
- `splash` 溅射（splash 半径）
- `chain` 闪电连锁（chain 目标数，chainRange 跳跃距离）
- `beam` 持续激光（beamDps，锁定一个目标）
- `pierce` 穿透弹（pierce = 可穿过几个目标）
- `poison` 中毒（poison 每秒伤害，poisonDur 持续）
- `crit` 暴击（critChance 概率，critMult 倍数）
- `homing` 追踪导弹（homing=true，必中）
- `fan` 扇形多弹（shots + spread）
- `burst` 连射（burst = 一轮几发）
- `aura` 光环（auraRadius 范围内友军 auraBuff 攻击力加成，自身不攻击）

炮塔共 **12 种**（v2 新增 4 种）：
`bottle` `arrow` `fan` `ice` `cannon` `magic` `tesla` `sun` `poison` `sniper` `missile` `drum`

| id | 名字 | strategy | 特点 |
|---|---|---|---|
| bottle | 瓶子塔 | single | 便宜均衡 |
| arrow | 弓箭塔 | pierce | 超远射程 + 穿透 |
| fan | 风扇塔 | fan | 扇形多弹 |
| ice | 冰冻塔 | splash | 减速 |
| cannon | 火炮塔 | splash | 高伤溅射 |
| magic | 魔法塔 | splash | 大范围 |
| tesla | 闪电塔 | chain | 连锁跳跃 |
| sun | 太阳花塔 | beam | 持续灼烧 |
| poison | 毒菇塔 | poison | 中毒持续掉血 |
| sniper | 狙击塔 | crit | 高暴击单体 |
| missile | 导弹塔 | homing | 追踪必中 |
| drum | 战鼓塔 | aura | 光环加攻，不攻击 |

每个塔 3 级。

## 3. 怪物（v2 重点：类型多样 + 终局 Boss）

enemies.json 新增字段：

```json
{
  "id": "rabbitFly", "name": "飞行兔", "hp": 180, "speed": 70,
  "reward": 18, "radius": 16, "armor": 0, "flying": true,
  "boss": false, "healAura": null, "shield": 0, "split": 0,
  "stealth": false, "regen": 0, "colors": {"body":"#fff","accent":"#9ad"},
  "desc": "……"
}
```

新字段：
- `flying`: 飞行（走直线，无视路径）—— 保留字段，v2 实际按路径走但画翅膀
- `shield`: 护盾值（先扣盾再扣血）
- `split`: 死亡时分裂成几只小怪
- `regen`: 每秒回血
- `stealth`: 半透明

怪物共 **12 种 + 3 个 Boss**：
`rabbit` 呆萌兔 / `rabbitFast` 疾风兔 / `rabbitTank` 铁甲兔 / `rabbitJump` 蹦蹦兔
`rabbitHeal` 药师兔 / `rabbitShield` 盾甲兔 / `rabbitFly` 飞行兔 / `rabbitSplit` 分裂兔
`rabbitGhost` 幽灵兔（stealth）/ `rabbitBerserk` 狂暴兔（越打越快）/ `rabbitArmored` 重装兔（高护甲）
Boss：`rabbitBoss` 萝卜王 / `rabbitKing` 兔王 / `finalBoss` 暗影龙王（最终 Boss，血量超长）

**最终 Boss 规则**：第 8 关**最后一波**必须出现 `finalBoss`，血量 ≥ 30000（配合波次成长后实际更高），
并且必须有专属血条（`#boss-bar`）与登场演出。

## 4. 道具（v2 重点：金币购买，不再掉落）

- **取消场上掉落**。改为主界面/游戏内**商店用金币购买**。
- 底部 `#item-bar` 显示 3 个道具按钮，各自标明价格；金币够点一下就直接买进背包。
- 道具：`bomb` 炸弹（120 金）、`freeze` 冰冻（90 金）、`lightning` 闪电（150 金）。
- 买了之后点按钮进入投放模式，再点地图释放。
- 关卡开始不送道具（v1 的「每波送 1~2 个」必须删掉）。

## 5. 画风（v2 重点）

目标：**明亮、饱和、圆润的卡通**，接近《保卫萝卜3》的观感。

- 主色：草绿 #7ec850 / 深绿 #4a8a32、土黄路 #e8c88a、橙 #ff9f43、粉 #ff7aa8、蓝 #4aa3ff、奶白 #fff6e5、深褐描边 #3b2f2a。
- 所有元素：**深色描边 + 顶部高光 + 底部阴影**，圆角，不要纯色平面。
- 地砖要有细节（草簇、小花、石子），不能只是纯色块。
- 炮塔要有明显朝向的炮口 / 装饰，三级逐级更华丽。
- 怪物要圆润可爱，眼睛大、有表情。

## 6. 前端模块边界（不变）

- `window.Sprites`（js/sprites.js）——全部程序化 Canvas 绘制
- `window.GameAudio`（js/audio.js）——WebAudio 合成
- `js/engine.js` 内核、`js/render.js` 渲染、`js/main.js` 主控

### 6.1 Sprites 接口（v2 扩展）

```js
window.Sprites = {
  init(),
  drawTower(ctx, towerId, level, x, y, t, opts),      // 12 种 × 3 级
  drawEnemy(ctx, enemyId, x, y, t, opts),             // 12 种 + 3 Boss
  drawCarrot(ctx, x, y, t, opts),
  drawPortal(ctx, x, y, t, opts),
  drawObstacle(ctx, kind, x, y, t, opts),             // 8 种；opts 含 {w,h} 多格尺寸
  drawObstacleHp(ctx, x, y, w, h, ratio),             // v2 新增：建筑血条
  drawProjectile(ctx, kind, x, y, t, opts),
  drawSlot(ctx, x, y, opts),
  drawTile(ctx, theme, col, row, t),
  drawDecor(ctx, theme, x, y, t),
  drawPickup(ctx, kind, x, y, t)                      // v2 新增：道具图标
}
```

### 6.2 必须保留的 DOM id（v2）

`#screen-menu` `#screen-levels` `#screen-collection` `#screen-game`
`#btn-play` `#btn-levels` `#btn-collection` `#btn-settings` `#menu-profile`
`#level-grid` `#levels-progress` `#btn-levels-back`
`#collection-tabs` `#collection-content` `#btn-collection-back`
`#game-stage` `#game-canvas` `#hud`
`#hud-coins` `#hud-carrot` `#hud-carrot-bar` `#hud-wave` `#hud-wave-timer` `#hud-open-spots`
`#btn-speed` `#btn-pause` `#tower-shop` `#tower-inspect` `#item-bar` `#build-hint`
`#wave-banner` `#boss-bar` `#boss-bar-fill` `#boss-bar-name` `#toast-layer`
`#modal-pause` `#modal-result` `#modal-settings` 及其内部既有按钮

v2 新增：`#shop-tabs`（炮塔 / 道具切换）、`#boss-warning`（Boss 登场警告）

## 7. 后端 API（不变）

`/api/health` `/api/profile` `/api/score` `/api/leaderboard`，存档在 `saves/`。

# -*- coding: utf-8 -*-
"""关卡/炮塔/敌人数据校验：python tests/validate_data.py

v2：建筑（障碍）改为可占 w×h 格，这里校验占格不压路径、不互相重叠、不越界，
并检查炮塔策略、怪物 v2 字段、第 8 关终局 Boss。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Windows 控制台默认 GBK，emoji 会直接抛 UnicodeEncodeError，这里统一转 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"

W, H = 20, 12
errors: list[str] = []
warns: list[str] = []

TOWER_IDS = ["bottle", "arrow", "fan", "ice", "cannon", "magic",
             "tesla", "sun", "poison", "sniper", "missile", "drum"]
STRATEGIES = {"single", "splash", "chain", "beam", "pierce", "poison",
              "crit", "homing", "fan", "burst", "aura"}
ENEMY_IDS = ["rabbit", "rabbitFast", "rabbitTank", "rabbitJump", "rabbitHeal",
             "rabbitShield", "rabbitFly", "rabbitSplit", "rabbitGhost",
             "rabbitBerserk", "rabbitArmored"]
BOSS_IDS = ["rabbitBoss", "rabbitKing", "finalBoss"]
OBSTACLE_KINDS = {"rock", "mushroom", "crate", "crystal", "tree", "house", "fence", "tower_rubble"}
ENEMY_FIELDS = ("id", "name", "hp", "speed", "reward", "radius", "armor", "flying",
                "boss", "healAura", "shield", "split", "stealth", "regen", "colors", "desc")


def load(name):
    with (DATA / name).open("r", encoding="utf-8") as fh:
        return json.load(fh)


def err(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


def path_cells(paths):
    cells, seen = [], set()
    for path in paths:
        for i in range(len(path) - 1):
            (x1, y1), (x2, y2) = path[i], path[i + 1]
            if x1 != x2 and y1 != y2:
                err("路径段非轴对齐: %s -> %s" % (path[i], path[i + 1]))
                continue
            if x1 == x2:
                rng = [(x1, y) for y in range(min(y1, y2), max(y1, y2) + 1)]
            else:
                rng = [(x, y1) for x in range(min(x1, x2), max(x1, x2) + 1)]
            for c in rng:
                if c not in seen:
                    seen.add(c)
                    cells.append(c)
    return cells, seen


def obstacle_cells(o):
    """建筑占用的所有格子（col,row 是左上角，占 w×h 格）。"""
    w = int(o.get("w", 1) or 1)
    h = int(o.get("h", 1) or 1)
    return [(o["col"] + dx, o["row"] + dy) for dy in range(h) for dx in range(w)]


def level_dps(s):
    """单目标的等效 DPS：用来检查每级强度是否约 1.7 倍（多弹 / 暴击 / 毒都算进去）。"""
    if s.get("strategy") == "aura":
        return (s.get("auraBuff") or 0) * 100
    if s.get("beamDps"):
        return s["beamDps"]
    cd = s.get("cooldown") or 0
    if cd <= 0:
        return 0
    shots = s.get("shots") or 1
    dps = (s.get("damage") or 0) * shots / cd
    crit = s.get("critChance") or 0
    crit_mult = s.get("critMult") or 1
    dps *= 1 + crit * (crit_mult - 1)
    dps += s.get("poison") or 0
    return dps


def check_towers(towers):
    for tid in TOWER_IDS:
        if tid not in towers:
            err("缺少炮塔 %s" % tid)
    for tid in towers:
        if tid not in TOWER_IDS:
            warn("炮塔 %s 不在契约列表里" % tid)

    for tid, t in towers.items():
        for field in ("name", "cost", "levels", "upgradeCost", "color"):
            if field not in t:
                err("炮塔 %s 缺字段 %s" % (tid, field))
        cost = t.get("cost", 0)
        if not 100 <= cost <= 420:
            err("炮塔 %s 价格 %s 超出 100~420 的梯度" % (tid, cost))
        up = t.get("upgradeCost") or []
        if len(up) != 2:
            err("炮塔 %s 升级费用应为 2 项" % tid)
        lv = t.get("levels") or []
        if len(lv) != 3:
            err("炮塔 %s 等级数应为 3，实际 %d" % (tid, len(lv)))

        prev = None
        prev_range = None
        for i, s in enumerate(lv):
            tag = "炮塔 %s 第%d级" % (tid, i + 1)
            strategy = s.get("strategy")
            if strategy not in STRATEGIES:
                err("%s strategy 无效: %r" % (tag, strategy))
            for field in ("pierce", "poison", "poisonDur", "critChance", "critMult",
                          "homing", "multiShotAngle", "burst", "auraRadius", "auraBuff"):
                if field not in s:
                    err("%s 缺策略字段 %s" % (tag, field))
            if s.get("critChance", 0) and not 0 <= s["critChance"] <= 1:
                err("%s critChance 应在 0..1" % tag)

            rng = s.get("range", 0)
            if not isinstance(rng, (int, float)) or rng <= 0:
                err("%s range 无效" % tag)

            if strategy == "aura":
                # 光环塔自身不攻击：damage/beamDps 必须为 0，靠 auraBuff 生效
                if s.get("damage", 0) != 0 or s.get("beamDps", 0) != 0:
                    err("%s 是光环塔，damage/beamDps 必须为 0" % tag)
                if not s.get("auraRadius", 0) > 0 or not s.get("auraBuff", 0) > 0:
                    err("%s 光环塔需要 auraRadius 与 auraBuff" % tag)
                dmg = s.get("auraBuff", 0) * 100
            else:
                raw = s.get("damage", 0) or s.get("beamDps", 0)
                dmg = level_dps(s)
                if raw <= 0 or dmg <= 0:
                    err("%s 无伤害来源" % tag)
                if s.get("beamDps", 0) > 0 and s.get("damage", 0) > 0:
                    err("%s 同时给了 damage 与 beamDps" % tag)

            if prev is not None:
                if dmg <= prev:
                    warn("%s 强度没有提升" % tag)
                elif strategy != "aura":
                    ratio = dmg / prev if prev else 0
                    if not 1.45 <= ratio <= 2.0:
                        warn("%s 成长倍率 %.2f× 偏离 1.7×/级" % (tag, ratio))
                if rng < prev_range:
                    warn("%s 射程下降" % tag)
            prev = dmg
            prev_range = rng

    if towers.get("drum", {}).get("levels", [{}])[0].get("damage") != 0:
        err("drum（战鼓塔）damage 必须为 0，靠光环加成")


def check_enemies(enemies):
    for eid in ENEMY_IDS + BOSS_IDS:
        if eid not in enemies:
            err("缺少敌人 %s" % eid)
    bosses = [eid for eid, e in enemies.items() if e.get("boss")]
    if len(bosses) < 3:
        err("Boss 数量应为 3，实际 %d: %s" % (len(bosses), bosses))
    normals = [eid for eid, e in enemies.items() if not e.get("boss")]
    if len(normals) < 12:
        err("普通怪数量应为 12，实际 %d" % len(normals))
    if enemies.get("finalBoss", {}).get("hp", 0) < 30000:
        err("finalBoss 血量必须 >= 30000")
    if not enemies.get("finalBoss", {}).get("final"):
        err("finalBoss 需要 final: true（专属血条 / 登场演出）")

    for eid, e in enemies.items():
        for field in ENEMY_FIELDS:
            if field not in e:
                err("敌人 %s 缺字段 %s" % (eid, field))
        if e.get("hp", 0) <= 0 or e.get("speed", 0) <= 0:
            err("敌人 %s 血量/速度为负" % eid)
        if not 0 <= e.get("armor", 0) < 1:
            err("敌人 %s 护甲应在 0..1" % eid)
        if e.get("reward", 0) <= 0:
            err("敌人 %s 奖励必须为正" % eid)
        if not isinstance(e.get("shield", 0), (int, float)) or e.get("shield", 0) < 0:
            err("敌人 %s shield 无效" % eid)
        if not isinstance(e.get("split", 0), int) or e.get("split", 0) < 0:
            err("敌人 %s split 无效" % eid)
        if not isinstance(e.get("regen", 0), (int, float)) or e.get("regen", 0) < 0:
            err("敌人 %s regen 无效" % eid)
        if not isinstance(e.get("stealth", False), bool):
            err("敌人 %s stealth 应为布尔" % eid)
        aura = e.get("healAura")
        if aura is not None:
            if not (aura.get("radius", 0) > 0 and aura.get("hps", 0) > 0):
                err("敌人 %s healAura 需要 radius 与 hps" % eid)
        colors = e.get("colors") or {}
        if not (colors.get("body") and colors.get("accent")):
            err("敌人 %s colors 需要 body/accent" % eid)
        if e.get("boss") and e.get("hp", 0) < 1000:
            warn("Boss %s 血量偏少: %d" % (eid, e["hp"]))


def check_enemy_sprite_ids(enemies):
    """sprites.js 里有专属调色板的怪，id 必须是契约里的。"""
    sp = ROOT / "web" / "js" / "sprites.js"
    if not sp.exists():
        return
    text = sp.read_text(encoding="utf-8", errors="replace")
    for eid in ("rabbitFly", "rabbitHeal", "rabbitBoss"):
        if eid + ":" in text and eid not in enemies:
            err("sprites.js 引用了未定义的敌人 %s" % eid)


def check_levels(levels, enemies):
    if len(levels) != 8:
        err("关卡数量应为 8，实际 %d" % len(levels))
    ids = [lv.get("id") for lv in levels]
    if len(set(ids)) != len(ids):
        err("关卡 id 重复: %s" % ids)

    themes = {"forest", "desert", "snow", "candy", "volcano", "sky"}
    cell_stats = {}
    for lv in levels:
        lid = lv.get("id", "?")
        for field in ("name", "theme", "paths", "slots", "waves", "carrotHp",
                      "startCoins", "starHp", "obstacles"):
            if field not in lv:
                err("%s 缺字段 %s" % (lid, field))
        if lv.get("theme") not in themes:
            err("%s 主题未知: %s" % (lid, lv.get("theme")))

        cells, cellset = path_cells(lv["paths"])
        for c in cells:
            cx, cy = c
            if not (-2 <= cx <= W + 1 and -2 <= cy <= H + 1):
                err("%s 路径格越界 %s" % (lid, c))

        starts = [tuple(p[0]) for p in lv["paths"]]
        if not any(s[0] < 0 or s[1] < 0 or s[0] >= W or s[1] >= H for s in starts):
            err("%s 没有网格外的敌人生成点" % lid)

        ends = {tuple(p[-1]) for p in lv["paths"]}
        if len(ends) > 1:
            warn("%s 有多条路径终点，请确认 %s" % (lid, sorted(ends)))

        slotset = set(map(tuple, lv["slots"]))
        for s in lv["slots"]:
            if tuple(s) in cellset:
                err("%s 塔位与路径重叠 %s" % (lid, s))
            if not (0 <= s[0] < W and 0 <= s[1] < H):
                err("%s 塔位越界 %s" % (lid, s))
        if len(slotset) != len(lv["slots"]):
            err("%s 塔位重复" % lid)

        # ---------------- 多格建筑 ----------------
        obs_cells = {}          # cell -> obstacle index
        stats = {"count": 0, "cells": 0, "bySize": {}}
        for oi, o in enumerate(lv.get("obstacles", [])):
            key = (o.get("col"), o.get("row"))
            tag = "%s 建筑#%d %s@%s" % (lid, oi, o.get("kind"), key)
            w = o.get("w", None)
            h = o.get("h", None)
            if w is None or h is None:
                err("%s 缺 w/h（多格建筑必填）" % tag)
                w, h = 1, 1
            if not (isinstance(w, int) and isinstance(h, int) and 1 <= w <= 3 and 1 <= h <= 3):
                err("%s w/h 必须是 1..3 的整数，实际 %rx%r" % (tag, w, h))
                w, h = max(1, min(3, int(w))), max(1, min(3, int(h)))
            if o.get("col") is None or o.get("row") is None:
                err("%s 缺 col/row" % tag)
                continue
            if o.get("kind") not in OBSTACLE_KINDS:
                err("%s 类型未知 %s" % (tag, o.get("kind")))
            if o.get("hp", 0) <= 0:
                err("%s 血量必须为正" % tag)
            if o.get("reward", 0) <= 0:
                err("%s 奖励必须为正" % tag)
            if "blockTower" not in o:
                err("%s 缺 blockTower" % tag)

            area = w * h
            for c in obstacle_cells(o):
                cx, cy = c
                if not (0 <= cx < W and 0 <= cy < H):
                    err("%s 建筑格越界 %s" % (tag, c))
                if c in cellset:
                    err("%s 建筑格与路径重叠 %s" % (tag, c))
                if c in slotset:
                    err("%s 建筑格与塔位重叠 %s" % (tag, c))
                if c in obs_cells:
                    err("%s 建筑格与建筑#%d 重叠 %s" % (tag, obs_cells[c], c))
                obs_cells[c] = oi

            # 血量按占格放大：单格 hp 必须比同关任何更小的建筑更高
            stats["count"] += 1
            stats["cells"] += area
            stats["bySize"][area] = stats["bySize"].get(area, 0) + 1

        mult = [o for o in lv.get("obstacles", []) if (o.get("w", 1) or 1) * (o.get("h", 1) or 1) > 1]
        single = [o for o in lv.get("obstacles", []) if (o.get("w", 1) or 1) * (o.get("h", 1) or 1) == 1]
        if not mult:
            err("%s 没有多格建筑（v2 要求 w/h 可 1..3 的多格建筑）" % lid)
        if single and mult:
            lo = min(o["hp"] for o in single)
            hi = max(o["hp"] for o in mult)
            if hi <= lo:
                warn("%s 多格建筑血量没有明显高于单格建筑（%d vs %d）" % (lid, hi, lo))
        else:
            lo = hi = 0
        for o in lv.get("obstacles", []):
            area = (o.get("w", 1) or 1) * (o.get("h", 1) or 1)
            if single and mult and area > 1 and o["hp"] <= lo:
                err("%s 建筑 %s 占 %d 格，血量 %d 没有超过单格建筑 %d"
                    % (lid, o.get("kind"), area, o["hp"], lo))
        cell_stats[lid] = stats

        star = lv["starHp"]
        if not (star[0] >= star[1] >= star[2] >= 1):
            err("%s starHp 必须降序且 >= 1: %s" % (lid, star))
        if star[0] > lv["carrotHp"]:
            err("%s 三星线超过萝卜血量" % lid)

        waves = lv["waves"]
        if not 3 <= len(waves) <= 6:
            err("%s 波次数量异常（应为 3~6）: %d" % (lid, len(waves)))
        total_spawn = 0
        for wi, w in enumerate(waves):
            if w.get("delay", 0) <= 0:
                err("%s 第%d波 delay 必须为正" % (lid, wi + 1))
            if not w.get("groups"):
                err("%s 第%d波 没有敌人组" % (lid, wi + 1))
            for g in w.get("groups", []):
                if g.get("enemy") not in enemies:
                    err("%s 第%d波 引用了不存在的敌人 %s" % (lid, wi + 1, g.get("enemy")))
                if not 0 <= g.get("path", 0) < len(lv["paths"]):
                    err("%s 第%d波 路径下标越界" % (lid, wi + 1))
                if g.get("count", 0) <= 0:
                    err("%s 第%d波 敌人数量必须为正" % (lid, wi + 1))
                if g.get("interval", 0) <= 0:
                    err("%s 第%d波 间隔必须为正" % (lid, wi + 1))
                if g.get("delay", 0) < 0:
                    err("%s 第%d波 组延迟不能为负" % (lid, wi + 1))
                total_spawn += g.get("count", 0)
        if total_spawn < 8:
            warn("%s 敌人总数偏少: %d" % (lid, total_spawn))

    # ---------------- 第 8 关：最后一波必须有 1 只 finalBoss，且小怪先来 ----------------
    lv8 = next((x for x in levels if x.get("id") == "lv8"), None)
    if lv8 is None:
        err("缺少第 8 关 lv8")
        return cell_stats
    last = lv8["waves"][-1]
    fin = [g for g in last["groups"] if g.get("enemy") == "finalBoss"]
    if len(fin) != 1:
        err("lv8 最后一波必须有且只有 1 组 finalBoss，实际 %d 组" % len(fin))
    else:
        if fin[0].get("count") != 1:
            err("lv8 最后一波 finalBoss 数量必须为 1，实际 %s" % fin[0].get("count"))
        if fin[0].get("path", 0) >= len(lv8["paths"]):
            err("lv8 finalBoss 路径下标越界")
        others = [g for g in last["groups"] if g.get("enemy") != "finalBoss"]
        if not others:
            err("lv8 最后一波只有 finalBoss，缺少先压上来的小怪")
        else:
            mob_count = sum(g.get("count", 0) for g in others)
            if mob_count < 15:
                warn("lv8 最后一波小怪只有 %d 只，压场感可能不足" % mob_count)
            # 小怪先来：finalBoss 组要带 delay，否则会和小怪同时冒出来
            if not fin[0].get("delay", 0) > 0:
                err("lv8 最后一波的 finalBoss 需要 delay>0，让小怪先压上来")
    for wi, w in enumerate(lv8["waves"][:-1]):
        for g in w["groups"]:
            if g.get("enemy") == "finalBoss":
                err("lv8 第%d波出现了 finalBoss，它只能出现在最后一波" % (wi + 1))
    return cell_stats


def main():
    towers = load("towers.json")
    enemies = load("enemies.json")
    levels = load("levels.json")

    check_towers(towers)
    check_enemies(enemies)
    check_enemy_sprite_ids(enemies)
    cell_stats = check_levels(levels, enemies)

    # ---------------- 输出 ----------------
    print("炮塔 %d 种 / 敌人 %d 种（普通 %d + Boss %d）/ 关卡 %d 关"
          % (len(towers), len(enemies),
             len([1 for e in enemies.values() if not e.get("boss")]),
             len([1 for e in enemies.values() if e.get("boss")]),
             len(levels)))
    total_cells = 0
    for lv in levels:
        st = cell_stats.get(lv["id"], {"count": 0, "cells": 0, "bySize": {}})
        total_cells += st["cells"]
        sizes = " ".join("%d格×%d" % (a, n) for a, n in sorted(st["bySize"].items()))
        print("  %-4s %-6s 主题 %-8s 塔位 %2d 波次 %d 建筑 %d 件/%2d 格 星线 %s  [%s]"
              % (lv["id"], lv["name"], lv["theme"], len(lv["slots"]),
                 len(lv["waves"]), st["count"], st["cells"], lv["starHp"], sizes))
    print("  建筑合计 %d 格（%d 件）" % (total_cells,
                                    sum(cell_stats[k]["count"] for k in cell_stats)))
    for w in warns:
        print("  [!] " + w)
    if errors:
        print("\n[FAIL] 发现 %d 处错误：" % len(errors))
        for e in errors:
            print("   x " + e)
        return 1
    print("\n[OK] 数据校验全部通过（%d 项警告）" % len(warns))
    return 0


if __name__ == "__main__":
    sys.exit(main())

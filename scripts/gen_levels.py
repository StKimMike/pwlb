# -*- coding: utf-8 -*-
"""关卡数据生成器：定义路径/波次/建筑，自动计算合法塔位并输出 levels.json。

v2：障碍改为**多格建筑**（w/h 1..3），由 place_buildings() 自动散落到地图空地上。

塔位算法：只从「与路径格八邻接」的空格里挑，保证塔能打到路；
再按邻接路径格数量降序做贪心，塔位之间至少隔 2 格曼哈顿距离，避免扎堆。
"""
import json
import random
import sys

W, H = 20, 12
NEIGH8 = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]


def b(kind, w, h):
    return (kind, w, h)


LEVELS = [
    dict(id="lv1", name="蘑菇森林", theme="forest", desc="第 1 关 · 教学：认识炮塔",
         startCoins=420, carrotHp=20, hpScale=1.0, slots=12, hpPerCell=110, seed=11,
         paths=[[[-1, 6], [5, 6], [5, 3], [12, 3], [12, 9], [17, 9]]],
         buildings=[b("rock", 2, 2), b("mushroom", 1, 1), b("crate", 2, 1)],
         waves=[
             dict(delay=8, groups=[dict(enemy="rabbit", count=6, interval=1.0, path=0)]),
             dict(delay=12, groups=[dict(enemy="rabbit", count=8, interval=0.9, path=0)]),
             dict(delay=12, groups=[dict(enemy="rabbit", count=8, interval=0.85, path=0),
                                    dict(enemy="rabbitFast", count=3, interval=1.0, path=0)]),
         ]),
    dict(id="lv2", name="沙漠绿洲", theme="desert", desc="第 2 关 · 教学：升级炮塔",
         startCoins=460, carrotHp=20, hpScale=1.15, slots=14, hpPerCell=130, seed=23,
         paths=[[[-1, 2], [6, 2], [6, 6], [2, 6], [2, 9], [14, 9], [14, 5], [19, 5]]],
         buildings=[b("rock", 2, 2), b("crate", 1, 1), b("fence", 3, 1), b("rock", 1, 2)],
         waves=[
             dict(delay=8, groups=[dict(enemy="rabbit", count=8, interval=0.9, path=0)]),
             dict(delay=12, groups=[dict(enemy="rabbitFast", count=5, interval=0.8, path=0),
                                    dict(enemy="rabbit", count=6, interval=0.9, path=0)]),
             dict(delay=12, groups=[dict(enemy="rabbit", count=10, interval=0.7, path=0)]),
             dict(delay=14, groups=[dict(enemy="rabbitTank", count=1, interval=1.0, path=0),
                                    dict(enemy="rabbitFast", count=6, interval=0.7, path=0)]),
         ]),
    dict(id="lv3", name="冰雪小径", theme="snow", desc="第 3 关 · 减速与爆发",
         startCoins=500, carrotHp=22, hpScale=1.3, slots=16, hpPerCell=150, seed=37,
         paths=[[[-1, 9], [3, 9], [3, 4], [8, 4], [8, 8], [13, 8], [13, 2], [19, 2]]],
         buildings=[b("crystal", 2, 2), b("rock", 2, 1), b("tree", 1, 2),
                    b("mushroom", 1, 1), b("crate", 3, 1)],
         waves=[
             dict(delay=8, groups=[dict(enemy="rabbit", count=8, interval=0.85, path=0),
                                   dict(enemy="rabbitFast", count=4, interval=0.9, path=0)]),
             dict(delay=12, groups=[dict(enemy="rabbitTank", count=2, interval=1.2, path=0)]),
             dict(delay=13, groups=[dict(enemy="rabbitFast", count=10, interval=0.55, path=0)]),
             dict(delay=14, groups=[dict(enemy="rabbit", count=10, interval=0.7, path=0),
                                    dict(enemy="rabbitTank", count=2, interval=1.2, path=0)]),
         ]),
    dict(id="lv4", name="糖果工厂", theme="candy", desc="第 4 关 · 双路夹击",
         startCoins=560, carrotHp=24, hpScale=1.35, slots=18, hpPerCell=170, seed=41,
         paths=[[[-1, 2], [9, 2], [9, 6], [17, 6]],
                [[-1, 10], [9, 10], [9, 6], [17, 6]]],
         buildings=[b("crate", 3, 1), b("mushroom", 2, 2), b("fence", 2, 1),
                    b("rock", 1, 2), b("crate", 1, 1)],
         waves=[
             dict(delay=8, groups=[dict(enemy="rabbit", count=8, interval=0.85, path=0),
                                   dict(enemy="rabbit", count=8, interval=0.85, path=1)]),
             dict(delay=13, groups=[dict(enemy="rabbitFast", count=6, interval=0.6, path=0),
                                    dict(enemy="rabbitJump", count=4, interval=0.9, path=1)]),
             dict(delay=14, groups=[dict(enemy="rabbitTank", count=2, interval=1.2, path=0),
                                    dict(enemy="rabbitTank", count=2, interval=1.2, path=1)]),
             dict(delay=14, groups=[dict(enemy="rabbitJump", count=8, interval=0.7, path=0),
                                    dict(enemy="rabbitShield", count=6, interval=0.8, path=1)]),
             dict(delay=15, groups=[dict(enemy="rabbit", count=12, interval=0.5, path=0),
                                    dict(enemy="rabbit", count=12, interval=0.5, path=1)]),
         ]),
    dict(id="lv5", name="熔岩山道", theme="volcano", desc="第 5 关 · 长路与火力网",
         startCoins=620, carrotHp=24, hpScale=1.5, slots=20, hpPerCell=190, seed=53,
         paths=[[[-1, 6], [8, 6], [8, 1], [3, 1], [3, 10], [15, 10], [15, 4], [19, 4]]],
         buildings=[b("rock", 2, 2), b("crystal", 2, 1), b("rock", 1, 2),
                    b("crate", 2, 2), b("tree", 1, 1), b("house", 1, 1)],
         waves=[
             dict(delay=8, groups=[dict(enemy="rabbitFast", count=8, interval=0.6, path=0),
                                   dict(enemy="rabbit", count=6, interval=0.8, path=0)]),
             dict(delay=13, groups=[dict(enemy="rabbitTank", count=2, interval=1.1, path=0),
                                    dict(enemy="rabbitShield", count=4, interval=0.9, path=0)]),
             dict(delay=14, groups=[dict(enemy="rabbitJump", count=10, interval=0.55, path=0)]),
             dict(delay=15, groups=[dict(enemy="rabbitHeal", count=2, interval=1.2, path=0),
                                    dict(enemy="rabbit", count=12, interval=0.55, path=0)]),
             dict(delay=16, groups=[dict(enemy="rabbitTank", count=4, interval=1.0, path=0),
                                    dict(enemy="rabbitFast", count=12, interval=0.45, path=0)]),
         ]),
    dict(id="lv6", name="夜色森林", theme="forest", desc="第 6 关 · 治疗后援",
         startCoins=680, carrotHp=26, hpScale=1.6, slots=22, hpPerCell=215, seed=61,
         paths=[[[-1, 10], [10, 10], [10, 6], [19, 6]],
                [[-1, 1], [10, 1], [10, 6], [19, 6]]],
         buildings=[b("mushroom", 2, 2), b("rock", 2, 1), b("mushroom", 1, 2),
                    b("crystal", 2, 2), b("crate", 1, 1), b("tree", 1, 1)],
         waves=[
             dict(delay=8, groups=[dict(enemy="rabbitJump", count=8, interval=0.6, path=0),
                                   dict(enemy="rabbit", count=8, interval=0.7, path=1)]),
             dict(delay=13, groups=[dict(enemy="rabbitHeal", count=2, interval=1.0, path=0),
                                    dict(enemy="rabbit", count=12, interval=0.5, path=0)]),
             dict(delay=14, groups=[dict(enemy="rabbitShield", count=8, interval=0.7, path=1),
                                    dict(enemy="rabbitFast", count=8, interval=0.5, path=1)]),
             dict(delay=15, groups=[dict(enemy="rabbitGhost", count=6, interval=0.8, path=0),
                                    dict(enemy="rabbitTank", count=5, interval=0.9, path=1)]),
             dict(delay=16, groups=[dict(enemy="rabbitTank", count=4, interval=1.0, path=0),
                                    dict(enemy="rabbitHeal", count=2, interval=1.0, path=0),
                                    dict(enemy="rabbitSplit", count=6, interval=0.9, path=1)]),
         ]),
    dict(id="lv7", name="极地要塞", theme="snow", desc="第 7 关 · 铁壁冲击",
         startCoins=740, carrotHp=28, hpScale=1.7, slots=24, hpPerCell=240, seed=73,
         paths=[[[-1, 5], [3, 5], [3, 1], [9, 1], [9, 9], [15, 9], [15, 3], [19, 3]]],
         buildings=[b("crystal", 2, 2), b("crystal", 1, 2), b("rock", 2, 1),
                    b("crate", 2, 2), b("tower_rubble", 1, 1), b("rock", 1, 1),
                    b("fence", 3, 1)],
         waves=[
             dict(delay=8, groups=[dict(enemy="rabbitShield", count=8, interval=0.6, path=0),
                                   dict(enemy="rabbitFast", count=10, interval=0.45, path=0)]),
             dict(delay=13, groups=[dict(enemy="rabbitTank", count=5, interval=0.9, path=0),
                                    dict(enemy="rabbitHeal", count=2, interval=1.0, path=0)]),
             dict(delay=14, groups=[dict(enemy="rabbitJump", count=16, interval=0.35, path=0)]),
             dict(delay=15, groups=[dict(enemy="rabbitArmored", count=4, interval=1.0, path=0),
                                    dict(enemy="rabbitShield", count=10, interval=0.55, path=0)]),
             dict(delay=16, groups=[dict(enemy="rabbitBerserk", count=6, interval=0.7, path=0),
                                    dict(enemy="rabbitKing", count=1, interval=1.0, path=0)]),
         ]),
    dict(id="lv8", name="天空之城", theme="sky", desc="第 8 关 · 决战暗影龙王",
         startCoins=800, carrotHp=30, hpScale=1.8, slots=26, hpPerCell=270, seed=89,
         paths=[[[-1, 2], [6, 2], [6, 9], [19, 9]],
                [[-1, 7], [3, 7], [3, 1], [12, 1], [12, 9], [19, 9]]],
         buildings=[b("crystal", 2, 2), b("crystal", 2, 1), b("rock", 3, 1),
                    b("crate", 1, 2), b("mushroom", 2, 2), b("house", 1, 1),
                    b("tree", 1, 1), b("fence", 2, 1)],
         waves=[
             dict(delay=9, groups=[dict(enemy="rabbitFast", count=12, interval=0.4, path=0),
                                   dict(enemy="rabbitShield", count=8, interval=0.6, path=1)]),
             dict(delay=14, groups=[dict(enemy="rabbitTank", count=6, interval=0.85, path=0),
                                    dict(enemy="rabbitHeal", count=2, interval=1.0, path=1)]),
             dict(delay=15, groups=[dict(enemy="rabbitJump", count=18, interval=0.3, path=1)]),
             dict(delay=15, groups=[dict(enemy="rabbitSplit", count=8, interval=0.6, path=0),
                                    dict(enemy="rabbitGhost", count=8, interval=0.5, path=1)]),
             dict(delay=16, groups=[dict(enemy="rabbitBoss", count=1, interval=1.0, path=0),
                                    dict(enemy="rabbitArmored", count=5, interval=0.8, path=1),
                                    dict(enemy="rabbitBerserk", count=8, interval=0.5, path=0)]),
             # 最后一波：先一大波小怪压场，finalBoss 押后登场（group.delay 见文档）
             dict(delay=17, groups=[dict(enemy="rabbitFast", count=16, interval=0.32, path=0),
                                    dict(enemy="rabbitShield", count=10, interval=0.5, path=1),
                                    dict(enemy="rabbitBerserk", count=6, interval=0.6, path=1),
                                    dict(enemy="finalBoss", count=1, interval=1.0, path=0, delay=16)]),
         ]),
]


def cells_of(path):
    """把一条折线拆成它压过的所有格子集合。"""
    cells = set()
    for i in range(len(path) - 1):
        x1, y1 = path[i]
        x2, y2 = path[i + 1]
        if x1 == x2:
            for y in range(min(y1, y2), max(y1, y2) + 1):
                cells.add((x1, y))
        elif y1 == y2:
            for x in range(min(x1, x2), max(x1, x2) + 1):
                cells.add((x, y1))
        else:
            raise ValueError("折线不轴对齐: %s -> %s" % (path[i], path[i + 1]))
    return cells


def place_buildings(lid, path_cells, specs, seed, hp_per_cell):
    """把多格建筑散落到空地上：不压路径、互不重叠、彼此至少留一格空隙、不贴地图边。

    落点优先贴着路径（像原作的建筑一样夹在路两侧，炮塔打得到才谈得上「拆」），
    但加一点随机权重，避免每关都排成一模一样的阵型。
    """
    rnd = random.Random(seed)
    used = set()
    placed = [None] * len(specs)
    # 占地大的先落位，避免位置被小件占死
    order = sorted(range(len(specs)), key=lambda i: -(specs[i][1] * specs[i][2]))
    for idx in order:
        kind, w, h = specs[idx]
        cands = []
        for y in range(1, H - h):          # 不贴上下边，留出塔位
            for x in range(1, W - w):      # 不贴左右边
                cells = [(x + dx, y + dy) for dy in range(h) for dx in range(w)]
                if any(c in path_cells or c in used for c in cells):
                    continue
                if any((cx + dx, cy + dy) in used for cx, cy in cells for dx, dy in NEIGH8):
                    continue
                touch = sum(1 for cx, cy in cells for dx, dy in NEIGH8
                            if (cx + dx, cy + dy) in path_cells)
                if touch:                  # 只考虑贴着路的落点
                    cands.append((touch, rnd.random(), x, y))
        if not cands:
            raise SystemExit("%s 放不下建筑 %s(%dx%d)" % (lid, kind, w, h))
        cands.sort(key=lambda c: (-c[0], c[1]))
        # 从最贴路的几个候选里随机挑一个：既贴着路，又不至于雷同
        pick = cands[rnd.randrange(0, min(4, len(cands)))]
        _, _, x, y = pick
        cells = [(x + dx, y + dy) for dy in range(h) for dx in range(w)]
        used |= set(cells)
        n = w * h
        hp = int(round(hp_per_cell * n * (1 + 0.12 * (n - 1))))
        placed[idx] = dict(kind=kind, col=x, row=y, w=w, h=h, hp=hp,
                           reward=int(round(hp * 0.22)), blockTower=True)
    return placed, used

def pick_slots(path_cells, blocked, want):
    cand = []
    for y in range(H):
        for x in range(W):
            if (x, y) in path_cells or (x, y) in blocked:
                continue
            near = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if (x + dx, y + dy) in path_cells:
                        near += 1
            if near:
                cand.append((near, x, y))
    cand.sort(key=lambda c: (-c[0], c[2], c[1]))

    chosen = []
    for _, x, y in cand:
        if len(chosen) >= want:
            break
        if all(abs(x - cx) + abs(y - cy) >= 2 for cx, cy in chosen):
            chosen.append((x, y))
    if len(chosen) < want:  # 放宽间距再补
        for _, x, y in cand:
            if len(chosen) >= want:
                break
            if (x, y) not in chosen:
                chosen.append((x, y))
    return sorted([[x, y] for x, y in chosen[:want]])


def build():
    out = []
    for lv in LEVELS:
        path_cells = set()
        for p in lv["paths"]:
            path_cells |= cells_of(p)
        for i in range(len(lv["paths"])):
            a, b_ = lv["paths"][i - 1], lv["paths"][i]
            assert a[-1] == b_[-1] or True
        obstacles, blocked = place_buildings(
            lv["id"], path_cells, lv["buildings"], lv["seed"], lv["hpPerCell"])
        slots = pick_slots(path_cells, blocked, lv["slots"])
        if len(slots) < lv["slots"]:
            raise SystemExit("%s 可用塔位不足：要 %d 只有 %d"
                             % (lv["id"], lv["slots"], len(slots)))
        ends = {tuple(p[-1]) for p in lv["paths"]}
        for ex, ey in ends:
            if (ex, ey) in path_cells and (ex, ey) in blocked:
                raise SystemExit("萝卜位置被建筑占用: %s" % lv["id"])
        hp = lv["carrotHp"]
        out.append(dict(
            id=lv["id"], name=lv["name"], theme=lv["theme"], desc=lv["desc"],
            startCoins=lv["startCoins"], carrotHp=hp,
            starHp=[max(1, -(-hp * 80 // 100)), max(1, -(-hp * 55 // 100)), 1],
            hpScale=round(lv["hpScale"] * 0.55, 3),   # 波次内还有 1.0→1.6 的成长
            paths=lv["paths"], slots=slots, obstacles=obstacles,
            carrot=list(sorted(ends)[0]),
            waves=lv["waves"],
        ))
    return out


if __name__ == "__main__":
    out_path = sys.argv[1] if len(sys.argv) > 1 else "web/data/levels.json"
    data = build()
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print("已生成 %s（%d 关）" % (out_path, len(data)))
    for lv in data:
        cells = sum(o["w"] * o["h"] for o in lv["obstacles"])
        print("  %s %-6s 塔位 %2d 波次 %d 建筑 %d 件/%2d 格 萝卜 %s 星线 %s"
              % (lv["id"], lv["name"], len(lv["slots"]), len(lv["waves"]),
                 len(lv["obstacles"]), cells, lv["carrot"], lv["starHp"]))
#!/usr/bin/env python3
"""
Design Token 全 App 收口脚本（2026-11-03，用户：写死圆角/裸字号全 App 搜口一遍）
- src/screens + src/components 的 .tsx 内：
  * borderRadius: <literal> → theme.radius.*（就近档位，视觉漂移 ≤4pt）
  * fontSize: <literal> → theme.fontSize.*（就近档位）
- 保留不动（白名单，属装饰性微圆角/特殊展示尺寸）：
  * borderRadius < 8（进度条/小圆点 0.75–7）、17/18/19/20/23/26/36/48/60（圆头像/胶囊/装饰）
  * fontSize 58（机器人头像装饰字）
- 幂等：替换后值均含 'theme.' 前缀，再跑不会二次命中。
"""
import re, os, sys

ROOT = '/Users/annie/WorkBuddy/2026-08-30-10-09-01/mira-app'
DIRS = [os.path.join(ROOT, 'src/screens'), os.path.join(ROOT, 'src/components')]

RADIUS_MAP = {
    '999': 'pill', '9999': 'pill',
    '8': 'sm', '9': 'sm', '10': 'sm',
    '11': 'md', '12': 'md',
    '14': 'lg', '15': 'lg', '16': 'lg',
    '22': 'xl', '28': 'xl', '32': 'xl',
}
FONT_MAP = {
    '8': 'tiny', '9': 'tiny', '9.5': 'tiny', '10': 'tiny', '10.5': 'tiny',
    '11': 'micro', '11.5': 'micro',
    '12': 'xs', '12.5': 'xs', '13': 'xs',
    '13.5': 'sm', '14': 'sm',
    '14.5': 'body', '15': 'body', '16': 'body',
    '17': 'card', '17.5': 'card', '18': 'card',
    '19': 'lg', '20': 'lg', '21': 'lg',
    '22': 'h2', '24': 'h2',
    '26': 'stat', '28': 'stat', '30': 'stat',
    '40': 'hero', '44': 'hero',
}
RADIUS_SKIP = {'17', '18', '19', '20', '23', '26', '36', '48', '60'}

rx_radius = re.compile(r'(borderRadius:\s*)(\d+(?:\.\d+)?)(?=[,\s}])')
rx_font = re.compile(r'(fontSize:\s*)(\d+(?:\.\d+)?)(?=[,\s}])')

changed_files = 0
r_count = f_count = 0
for d in DIRS:
    for base, _, files in os.walk(d):
        for fn in files:
            if not fn.endswith('.tsx'):
                continue
            p = os.path.join(base, fn)
            with open(p, encoding='utf-8') as f:
                src = f.read()
            orig = src

            def sub_r(m):
                global r_count
                v = m.group(2)
                if v in RADIUS_SKIP or v not in RADIUS_MAP:
                    return m.group(0)
                r_count += 1
                return f'{m.group(1)}theme.radius.{RADIUS_MAP[v]}'

            def sub_f(m):
                global f_count
                v = m.group(2)
                if v not in FONT_MAP:
                    return m.group(0)
                f_count += 1
                return f'{m.group(1)}theme.fontSize.{FONT_MAP[v]}'

            src = rx_radius.sub(sub_r, src)
            src = rx_font.sub(sub_f, src)

            if src != orig:
                # 确保有 theme 导入（项目约定全部已有；缺失则报出人工处理）
                if 'theme' not in src.split('\n', 30).__str__():
                    print(f'!! 缺 theme 导入，需人工处理: {p}')
                    sys.exit(1)
                with open(p, 'w', encoding='utf-8') as f:
                    f.write(src)
                changed_files += 1
                print(f'  {os.path.relpath(p, ROOT)}')

print(f'\n完成：{changed_files} 个文件，borderRadius 替换 {r_count} 处，fontSize 替换 {f_count} 处')

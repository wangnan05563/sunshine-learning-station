# -*- coding: utf-8 -*-
"""生成「阳光学习能量站」品牌资产：

- assets/logo.png            —— 太阳标识（1024×1024，透明底，可当 favicon/头像）
- assets/social-preview.png  —— GitHub 社交预览图（严格 1280×640）

纯 Pillow 绘制（4× 超采样后降采样），中文字体取系统 Microsoft YaHei。
运行：python _gen_assets.py            # 全量重建
      python _gen_assets.py preview    # 只重建社交预览图（logo 以 assets/logo.png 为源）
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "assets")
os.makedirs(OUT, exist_ok=True)

SS = 4  # supersample
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_REG = r"C:\Windows\Fonts\msyh.ttc"

W, H = 1280, 640
BG_TL = (255, 251, 240)   # 左上 暖白
BG_BR = (255, 226, 178)   # 右下 暖橙
GLOW = (255, 183, 77)
INK = (61, 44, 30)
INK_SUB = (138, 106, 75)
SUN_HI = (255, 229, 127)
SUN_LO = (255, 138, 0)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def gradient_bg(w, h, c1, c2):
    """对角线性渐变。"""
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    n = max(w, h)
    for i in range(n):
        t = i / float(n - 1)
        col = lerp(c1, c2, t)
        # 沿对角推进：同时画一条斜线代价高，改用「按行 + 按列」线性叠加近似
        d.line([(0, i), (i, 0)], fill=col) if i < h else None
        if i < w:
            d.line([(i, 0), (i, h)], fill=col)
    return img


def diagonal_gradient(w, h, c1, c2):
    img = Image.new("RGB", (w, h))
    px = img.load()
    n = float(w + h - 2)
    for y in range(h):
        for x in range(w):
            px[x, y] = lerp(c1, c2, (x + y) / n)
    return img


def radial_glow(size, color, strength=0.55):
    """中心亮、边缘透明的圆形光晕（RGBA）。"""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = cy = size / 2.0
    steps = 180
    for i in range(steps, 0, -1):
        r = size / 2.0 * i / steps
        t = 1 - i / float(steps)
        a = int(255 * strength * (t ** 2.2))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    return layer


def rounded_rect(d, box, radius, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_sun(size):
    """太阳标识：12 道圆角光芒 + 径向渐变圆盘 + 高光。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    R = size / 2.0
    cx = cy = R

    # --- 光芒（旋转圆角矩形） ---
    ray_len = R * 0.92
    ray_in = R * 0.60
    ray_w = max(2, int(R * 0.115))
    ray_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ray_img)
    rr = ray_w / 2.0
    y0 = R - ray_len
    y1 = R - ray_in
    rd.rounded_rectangle([cx - rr, y0, cx + rr, y1], radius=rr,
                         fill=lerp(SUN_LO, SUN_HI, 0.35) + (255,))
    for i in range(1, 12):
        ang = 360.0 * i / 12.0
        rot = ray_img.rotate(ang, center=(cx, cy), resample=Image.BICUBIC)
        img = Image.alpha_composite(img, rot)
    img = Image.alpha_composite(img, ray_img)

    # --- 圆盘（径向渐变：中心暖黄 → 边缘橙） ---
    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dd = ImageDraw.Draw(disc)
    r_out = R * 0.66
    steps = 220
    for i in range(steps, 0, -1):
        r = r_out * i / steps
        t = i / float(steps)
        col = lerp(SUN_HI, SUN_LO, t)
        dd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col + (255,))

    # 高光（左上）
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hr = r_out * 0.42
    for i in range(60, 0, -1):
        r = hr * i / 60.0
        a = int(70 * (1 - i / 60.0))
        hd.ellipse([cx - r_out * 0.34 - r, cy - r_out * 0.34 - r,
                    cx - r_out * 0.34 + r, cy - r_out * 0.34 + r],
                   fill=(255, 255, 255, a))
    disc = Image.alpha_composite(disc, hl)
    img = Image.alpha_composite(img, disc)
    return img


def font(path, size):
    return ImageFont.truetype(path, size)


def text_w(d, s, f):
    return d.textbbox((0, 0), s, font=f)[2] - d.textbbox((0, 0), s, font=f)[0]


def build_logo():
    size = 1024
    sun = draw_sun(size)
    sun.save(os.path.join(OUT, "logo.png"))
    return sun


def build_favicon(sun):
    """T00648：由 logo 派生多尺寸 favicon.ico（16/32/48）。"""
    fp = os.path.join(OUT, "favicon.ico")
    sun.save(fp, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    return fp


def build_svg_logo():
    """T00648：太阳标识的 SVG 矢量源（数值忠实换算自 draw_sun 的 PIL 逻辑）。

    draw_sun（size=1024, R=512）关键数值：
      ray: y0=R-0.92R=40.96, y1=R-0.60R=204.8, 宽=0.115R=58.88, 圆角=29.44
           颜色 lerp(SUN_LO,SUN_HI,0.35) = (255,170,44) = #FFAA2C，12 道 × 30°
      disc: r=0.66R=337.92，径向渐变 #FFE57F(中心) → #FF8A00(边缘)
      高光: 圆心 (512-0.34·337.92, 同) = (397.1, 397.1)，r=0.42·337.92=141.9，
            中心白 alpha≈70/255≈0.27 渐隐至 0
    """
    R = 512.0
    rw = 0.115 * R
    y0 = R - 0.92 * R
    h = (0.92 - 0.60) * R
    rays = "\n".join(
        f'  <rect x="{R - rw / 2:.2f}" y="{y0:.2f}" width="{rw:.2f}" height="{h:.2f}" '
        f'rx="{rw / 2:.2f}" transform="rotate({a} {R:.0f} {R:.0f})"/>'
        for a in range(0, 360, 30)
    )
    hx = R - 0.34 * (0.66 * R)
    hr = 0.42 * (0.66 * R)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <radialGradient id="disc" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFE57F"/>
      <stop offset="100%" stop-color="#FF8A00"/>
    </radialGradient>
    <radialGradient id="hl" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.27"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g fill="#FFAA2C">
{rays}
  </g>
  <circle cx="{R:.0f}" cy="{R:.0f}" r="{0.66 * R:.2f}" fill="url(#disc)"/>
  <circle cx="{hx:.1f}" cy="{hx:.1f}" r="{hr:.1f}" fill="url(#hl)"/>
</svg>
'''
    fp = os.path.join(OUT, "logo.svg")
    with open(fp, "w", encoding="utf-8") as f:
        f.write(svg)
    return fp


def load_sun():
    """预览图的太阳标识以 assets/logo.png 为源：logo 一旦更新，预览图重跑即跟随。
    文件缺失时（首次构建）回退到 draw_sun 现算。"""
    lp = os.path.join(OUT, "logo.png")
    if os.path.exists(lp):
        im = Image.open(lp)
        if im.size == (1024, 1024) and im.mode == "RGBA":
            return im
    return draw_sun(1024)


def checkin_matrix(d, x, y, cols=7, rows=2, cell=104, r=34):
    """打卡日历点阵（FR-28 月历热力图的图形语言）——纯图形，不引入文字。
    x/y/cell/r 均按 CSS px 传入，内部乘超采样倍率。"""
    pat = [
        [2, 2, 1, 2, 2, 2, 0],
        [2, 1, 2, 2, 2, 0, 1],
    ]
    c, rad = cell * SS, r * SS
    for ry in range(rows):
        for cx in range(cols):
            lvl = pat[ry % len(pat)][cx % len(pat[0])]
            px, py = x + cx * c, y + ry * c
            box = [px, py, px + rad * 2, py + rad * 2]
            if lvl == 0:
                d.ellipse(box, outline=(208, 170, 122), width=int(3 * SS))
            else:
                col = (255, 190, 105) if lvl == 1 else lerp(SUN_HI, SUN_LO, 0.86)
                d.ellipse(box, fill=col)


def build_preview(sun):
    w, h = W * SS, H * SS
    img = diagonal_gradient(w, h, BG_TL, BG_BR).convert("RGBA")

    # 右上暖光晕
    glow = radial_glow(int(1100 * SS / 2) * 2, GLOW, strength=0.42)
    img.alpha_composite(glow, dest=(int(760 * SS), int(-170 * SS)))
    # 左下淡光晕
    glow2 = radial_glow(int(700 * SS / 2) * 2, (255, 213, 128), strength=0.30)
    img.alpha_composite(glow2, dest=(int(-180 * SS), int(380 * SS)))

    # 右下装饰太阳水印（让位给点阵带，只占右侧空白区）
    wm = sun.resize((int(460 * SS), int(460 * SS)), Image.LANCZOS)
    wm.putalpha(wm.getchannel("A").point(lambda a: int(a * 0.12)))
    img.alpha_composite(wm, dest=(int(940 * SS), int(300 * SS)))
    d = ImageDraw.Draw(img)

    # 左侧 logo：视觉焦点，缩略到 480px 宽后仍占约 1/5 画幅
    logo_size = int(212 * SS)
    lg = sun.resize((logo_size, logo_size), Image.LANCZOS)
    img.alpha_composite(lg, dest=(int(96 * SS), int(146 * SS)))
    d = ImageDraw.Draw(img)

    tx = int(364 * SS)
    f_title = font(FONT_BOLD, int(86 * SS))
    f_sub = font(FONT_REG, int(33 * SS))

    # 文字严格两行（约束：不超过两行）
    d.text((tx, int(132 * SS)), "阳光学习能量站", font=f_title, fill=INK)
    d.text((tx, int(268 * SS)), "单文件 · 离线 · 零依赖的儿童学习打卡工作台",
           font=f_sub, fill=(92, 70, 51))

    # 分隔线 + 打卡点阵带（图形化交代「这是什么产品」，不增加文字行）
    d.line([(tx, int(356 * SS)), (int(920 * SS), int(356 * SS))],
           fill=(226, 190, 140), width=int(2 * SS))
    checkin_matrix(d, tx, int(398 * SS), cell=84, r=26)

    img = img.resize((W, H), Image.LANCZOS)
    img.convert("RGB").save(os.path.join(OUT, "social-preview.png"), optimize=True)


def verify_preview():
    p = os.path.join(OUT, "social-preview.png")
    im = Image.open(p)
    assert im.size == (1280, 640), im.size
    size = os.path.getsize(p)
    assert 0 < size < 1024 * 1024, size   # GitHub 社交预览上限 1MB
    print("social-preview.png", im.size, im.mode, size, "bytes")
    return p


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "preview":
        build_preview(load_sun())
        verify_preview()
        return
    sun = build_logo()
    build_favicon(sun)
    build_svg_logo()
    print("logo.png", Image.open(os.path.join(OUT, "logo.png")).size,
          os.path.getsize(os.path.join(OUT, "logo.png")), "bytes")
    build_preview(load_sun())
    verify_preview()


if __name__ == "__main__":
    main()


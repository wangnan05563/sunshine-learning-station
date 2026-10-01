# -*- coding: utf-8 -*-
"""生成「阳光学习能量站」品牌资产：

- assets/logo.png            —— 太阳标识（1024×1024，透明底，可当 favicon/头像）
- assets/social-preview.png  —— GitHub 社交预览图（严格 1280×640）

纯 Pillow 绘制（4× 超采样后降采样），中文字体取系统 Microsoft YaHei。
运行：python _gen_assets.py
"""
import math
import os

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


def build_preview(sun):
    w, h = W * SS, H * SS
    img = diagonal_gradient(w, h, BG_TL, BG_BR).convert("RGBA")
    d = ImageDraw.Draw(img)

    # 右上暖光晕
    glow = radial_glow(int(1100 * SS / 2) * 2, GLOW, strength=0.42)
    img.alpha_composite(glow, dest=(int(760 * SS), int(-170 * SS)))
    # 左下淡光晕
    glow2 = radial_glow(int(700 * SS / 2) * 2, (255, 213, 128), strength=0.30)
    img.alpha_composite(glow2, dest=(int(-180 * SS), int(380 * SS)))
    d = ImageDraw.Draw(img)

    # 右下装饰太阳水印
    wm = sun.resize((int(520 * SS), int(520 * SS)), Image.LANCZOS)
    wm.putalpha(wm.getchannel("A").point(lambda a: int(a * 0.16)))
    img.alpha_composite(wm, dest=(int(870 * SS), int(240 * SS)))
    d = ImageDraw.Draw(img)

    # 左侧 logo
    logo_size = int(176 * SS)
    lg = sun.resize((logo_size, logo_size), Image.LANCZOS)
    lx, ly = int(96 * SS), int(238 * SS)
    img.alpha_composite(lg, dest=(lx, ly))
    d = ImageDraw.Draw(img)

    tx = int(316 * SS)

    f_title = font(FONT_BOLD, int(74 * SS))
    f_en = font(FONT_REG, int(28 * SS))
    f_sub = font(FONT_REG, int(31 * SS))

    title = "阳光学习能量站"
    d.text((tx, int(228 * SS)), title, font=f_title, fill=INK)

    en = "S U N S H I N E   L E A R N I N G   S T A T I O N"
    d.text((tx + int(4 * SS), int(336 * SS)), en, font=f_en, fill=INK_SUB)

    sub = "单文件 · 离线 · 零依赖 的儿童学习打卡工作台"
    d.text((tx, int(392 * SS)), sub, font=f_sub, fill=(92, 70, 51))

    # 分隔线
    d.line([(int(96 * SS), int(464 * SS)), (int(760 * SS), int(464 * SS))],
           fill=(226, 190, 140), width=int(2 * SS))

    # 功能标签
    chips = ["单元任务打卡", "阳光值激励", "连续打卡", "兑换商店",
             "本地周报", "专注计时", "多人竞速", "家长中心"]
    f_chip = font(FONT_REG, int(25 * SS))
    pad_x, pad_y = int(20 * SS), int(11 * SS)
    gap = int(14 * SS)
    gap_y = int(16 * SS)
    x, y = int(96 * SS), int(482 * SS)
    row_x = x
    max_right = int(1184 * SS)
    for c in chips:
        tw = text_w(d, c, f_chip)
        cw = tw + pad_x * 2
        ch = int(25 * SS) + pad_y * 2
        if row_x + cw > max_right:  # 换行
            x = int(96 * SS)
            row_x = x
            y += ch + gap_y
        rounded_rect(d, [x, y, x + cw, y + ch], radius=ch // 2,
                     fill=(255, 255, 255, 205), outline=(240, 197, 130), width=int(2 * SS))
        d.text((x + pad_x, y + pad_y - int(2 * SS)), c, font=f_chip, fill=(120, 88, 50))
        x += cw + gap
        row_x = x

    img = img.resize((W, H), Image.LANCZOS)
    img.convert("RGB").save(os.path.join(OUT, "social-preview.png"), optimize=True)


def main():
    sun = build_logo()
    build_preview(sun)
    favicon = build_favicon(sun)
    svg = build_svg_logo()
    for name in ("logo.png", "social-preview.png"):
        p = os.path.join(OUT, name)
        im = Image.open(p)
        print(name, im.size, im.mode, os.path.getsize(p), "bytes")
        assert os.path.getsize(p) > 0
    sp = Image.open(os.path.join(OUT, "social-preview.png"))
    assert sp.size == (1280, 640), sp.size
    ico = Image.open(favicon)
    print("favicon.ico", ico.size, os.path.getsize(favicon), "bytes")
    assert os.path.getsize(favicon) > 0
    print("logo.svg", os.path.getsize(svg), "bytes")
    assert os.path.getsize(svg) > 0


if __name__ == "__main__":
    main()

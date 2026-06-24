"""Generate a demo video for Codecan using Pillow frames + ImageMagick."""
import subprocess, shutil, os, tempfile, textwrap
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 720
BG = (30, 30, 35)
FG = (220, 220, 225)
ACCENT = (34, 197, 94)
RED = (239, 68, 68)
AMBER = (245, 158, 11)
BLUE = (59, 130, 246)

def font(size=28):
    try: return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
    except: return ImageFont.load_default()

def font_reg(size=22):
    try: return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)
    except: return ImageFont.load_default()

def draw_window(draw):
    draw.rectangle([0, 0, W-1, H-1], fill=(20, 20, 25), outline=(60, 60, 70))
    draw.rectangle([0, 0, W-1, 40], fill=(40, 40, 48))  # title bar
    draw.ellipse([12, 13, 22, 23], fill=RED)  # close btn
    draw.ellipse([27, 13, 37, 23], fill=AMBER)  # min btn
    draw.ellipse([42, 13, 52, 23], fill=BLUE)  # max btn
    draw.text((60, 12), "Codecan v0.1.0", fill=(160, 160, 170), font=font_reg(14))

def draw_header(draw, issues=0, tokens=0, credits=60):
    draw.rectangle([20, 55, W-20, 95], fill=(40, 40, 48), outline=(60, 60, 70))
    draw.text((35, 67), f"{issues} issues", fill=FG, font=font(18))
    draw.text((160, 67), f"{tokens} tokens", fill=(168, 85, 247), font=font(18))
    draw.text((300, 67), f"{credits}/60 credits", fill=AMBER, font=font(18))

def draw_input(draw, path=""):
    draw.rectangle([20, 110, W-20, 150], fill=(40, 40, 48), outline=(60, 60, 70))
    draw.text((35, 122), path or "/home/user/project", fill=(140, 140, 150), font=font_reg(16))
    draw.rectangle([W-150, 112, W-30, 148], fill=ACCENT)
    draw.text((W-130, 122), "Browse", fill="white", font=font(16))

def draw_button(draw, x, y, w, h, text, color=ACCENT, disabled=False):
    c = (100, 100, 110) if disabled else color
    draw.rectangle([x, y, x+w, y+h], fill=c, outline=(c[0]+20, c[1]+20, c[2]+20))
    tw, _ = draw.textbbox((0, 0), text, font=font(16))[2:4]
    draw.text((x + w//2 - tw//2, y + (h-20)//2), text, fill="white" if not disabled else (120,120,130), font=font(16))

def draw_results_panel(draw, items):
    draw.rectangle([20, 170, W-20, 400], fill=(35, 35, 42), outline=(60, 60, 70))
    draw.text((35, 180), "Scan Results", fill=FG, font=font(18))
    for i, (cat, count, sev) in enumerate(items):
        y = 215 + i * 45
        c = RED if sev == "error" else AMBER if sev == "warning" else BLUE
        draw.rectangle([35, y, W-35, y+35], fill=(45, 45, 52))
        draw.text((50, y+7), f"{cat}", fill=FG, font=font(16))
        draw.text((W-140, y+7), f"{count} {sev}", fill=c, font=font(14))

def draw_ai_progress(draw, msg):
    draw.rectangle([20, 420, W-20, 460], fill=(50, 45, 25), outline=(100, 90, 30))
    draw.text((35, 432), msg, fill=AMBER, font=font_reg(16))

def draw_logo(draw):
    draw.text((W//2-60, H//2-40), "CODECAN", fill=ACCENT, font=font(48))

def frame_basic(title, subtitle=""):
    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    draw_window(draw)
    draw_header(draw)
    draw_input(draw)
    draw_button(draw, 20, 165, 100, 36, "Scan")
    draw_button(draw, 130, 165, 140, 36, "Scan with AI", color=ACCENT)
    draw_button(draw, 280, 165, 160, 36, "Scan This Project")
    if title:
        tw, _ = draw.textbbox((0, 0), title, font=font(32))[2:4]
        draw.text((W//2 - tw//2, H//2), title, fill=FG, font=font(32))
    if subtitle:
        draw.text((W//2-200, H//2+40), subtitle, fill=(160, 160, 170), font=font_reg(20))
    return img

def create_frames():
    frames = []
    for _ in range(30): frames.append(frame_basic("", ""))

    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    draw_window(draw); draw_header(draw); draw_input(draw, "/home/user/project")
    draw_button(draw, 20, 165, 100, 36, "Scan", disabled=True)
    draw_button(draw, 130, 165, 140, 36, "Scan with AI", color=ACCENT)
    draw_button(draw, 280, 165, 160, 36, "Scan This Project")
    draw_results_panel(draw, [
        ("Duplicate Code", 3, "warning"),
        ("Unused Code", 5, "warning"),
        ("Redundant Code", 2, "info"),
        ("Architecture", 1, "error"),
        ("Dependencies", 4, "warning"),
    ])
    for _ in range(30): frames.append(img)

    img = frame_basic("", "")
    draw = ImageDraw.Draw(img)
    draw_ai_progress(draw, "Analyzing styles.css (1/5)...")
    for _ in range(30): frames.append(img)

    img = frame_basic("AI Scan Complete", "5 error(s) - check the log drawer")
    draw = ImageDraw.Draw(img)
    draw_results_panel(draw, [
        ("AI Issues", 8, "warning"),
        ("Duplicate Code", 3, "warning"),
        ("Unused Code", 5, "warning"),
    ])
    draw_ai_progress(draw, "AI scan completed with 5 error(s)")
    for _ in range(30): frames.append(img)

    img = frame_basic("", "")
    draw = ImageDraw.Draw(img)
    draw_logo(draw)
    for _ in range(30): frames.append(img)

    return frames

def main():
    tmpdir = tempfile.mkdtemp()
    print(f"Generating frames in {tmpdir}...")
    frames = create_frames()
    paths = []
    for i, f in enumerate(frames):
        p = os.path.join(tmpdir, f"frame_{i:04d}.png")
        f.save(p)
        paths.append(p)
    print(f"Generated {len(frames)} frames")

    out = os.path.join(os.path.dirname(__file__), "..", "static", "demo.gif")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fps = 10
    cmd = ["convert", "-delay", f"{100//fps}", "-loop", "0"] + paths + [out]
    subprocess.run(cmd, check=True)
    print(f"GIF saved to {out} ({os.path.getsize(out) / 1024:.0f} KB)")
    shutil.rmtree(tmpdir)

if __name__ == "__main__":
    main()

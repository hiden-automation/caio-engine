"""Recorte de fundo (pessoa/cachorro) com rembg. Uso: cutout.py entrada saida.png"""
import sys
from PIL import Image
from rembg import new_session, remove

session = new_session("isnet-general-use")
for src, dst in zip(sys.argv[1::2], sys.argv[2::2]):
    img = Image.open(src).convert("RGB")
    out = remove(img, session=session, post_process_mask=True)
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    out.save(dst)
    print(dst, flush=True)

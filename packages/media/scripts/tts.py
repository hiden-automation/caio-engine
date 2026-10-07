"""Narração com voz neural de locutor (Edge TTS) e o tempo de cada palavra.

Uso: tts.py pedido.json
pedido = {"voice": "pt-BR-AntonioNeural", "rate": "+6%", "items": [{"text": "...", "out": "cena-1.mp3"}]}
Escreve, ao lado de cada mp3, um .json com [{"t": segundos, "d": duração, "w": "palavra"}].
"""
import asyncio
import json
import sys

import edge_tts


async def speak(text: str, voice: str, rate: str, out: str) -> None:
    words = []
    com = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    with open(out, "wb") as f:
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({"t": chunk["offset"] / 1e7, "d": chunk["duration"] / 1e7, "w": chunk["text"]})
    with open(out[: out.rfind(".")] + ".json", "w", encoding="utf8") as f:
        json.dump(words, f, ensure_ascii=False)


async def main() -> None:
    with open(sys.argv[1], encoding="utf8") as f:
        req = json.load(f)
    for item in req["items"]:
        for attempt in range(3):
            try:
                await speak(item["text"], req["voice"], req.get("rate", "+0%"), item["out"])
                break
            except Exception:
                if attempt == 2:
                    raise
                await asyncio.sleep(2 * (attempt + 1))
        print(item["out"], flush=True)


asyncio.run(main())

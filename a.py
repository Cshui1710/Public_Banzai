import requests

url = "https://data.bodik.jp/dataset/b6811b15-7783-492f-9421-de2a91359920/resource/206b5cea-74cb-4dc6-92a0-bbe3f51e3424/download/h27ka01_367.geojson"

r = requests.get(url, verify=False, timeout=60)
if r.status_code == 200:
    with open("h27ka01_367.geojson", "wb") as f:
        f.write(r.content)
    print("✅ 保存完了: h27ka01_367.geojson")
else:
    print(f"❌ エラー: {r.status_code}")

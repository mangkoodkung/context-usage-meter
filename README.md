# 📊 Context Usage Meter

🇹🇭 [ภาษาไทย](#ภาษาไทย) · 🇬🇧 [English](#english)

A responsive context meter and safety assistant for [SillyTavern](https://github.com/SillyTavern/SillyTavern). It tracks the real outgoing Chat Completion prompt, warns before the context becomes unsafe, and can update SillyTavern's actual Context Size.

---

## ภาษาไทย

**Context Usage Meter** ช่วยให้เห็นว่าพรอมท์จริงที่กำลังส่งออกใช้ context ไปเท่าไร เหลือพื้นที่ให้โมเดลตอบแค่ไหน และเตือนก่อนที่บทสนทนาจะใหญ่จนเริ่มตอบไม่ออก

> รองรับ **Chat Completion** เช่น OpenAI, Claude และ Gemini

### ฟีเจอร์

- **มิเตอร์แบบเรียลไทม์:** นับ token จากพรอมท์จริงในจังหวะส่ง พร้อมแสดงเปอร์เซ็นต์ เพดาน Context และ Response Reserve
- **แจ้งเตือนตามเกณฑ์:** เลือกจุดเตือนได้ตั้งแต่ 50–80% การเตือนจะแสดงครั้งเดียวต่อการข้ามเกณฑ์และปิดเองได้
- **Safe Context Size:** แก้ค่า Context Size จริงของ SillyTavern โดยตรง มีตัวเลือก Flash 90k, Pro 200k และกำหนดเอง
- **ตัวช่วยตั้งค่าครั้งแรก:** เลือกโปรไฟล์ที่ต้องการตอนเปิดใช้งานครั้งแรก หรือเปิดตัวช่วยใหม่จากหน้า Settings ได้ตลอด
- **ยืนยันค่าที่สูงมาก:** ค่าเกิน 200,000 tokens ต้องยืนยันก่อน และส่วนเสริมจะเปิด Context Unlock ของ SillyTavern เมื่อจำเป็น
- **รูปแบบพื้นฐาน:** หลอดบาง, แคปซูล และช่องแบ่ง
- **รูปแบบ Advanced:** วงแหวน, ป้ายตัวเลข, Floating Orb, Context Familiar, Magic Constellation, Edge Bookmark และ Ambient Aura
- **ปรับขนาดมิเตอร์ Advanced:** ปรับได้ 50–120% โดย Ambient Aura จะคงขนาดเดิม
- **มิเตอร์ลอย:** ลากตำแหน่งได้ ดูดติดขอบจอ และค่อย ๆ จางเมื่อไม่ได้ใช้งาน
- **Context Familiar:** มีตัวเลือก 12 แบบและเปลี่ยนอารมณ์ตามระดับ context
- **ธีมสี:** มีชุดสีสำเร็จรูปและสี Custom ที่บันทึกไว้ใช้ซ้ำได้
- **รองรับมือถือ:** รายละเอียดและหน้าต่างตั้งค่าปรับตามขนาดหน้าจอ

### Summarize

ฟีเจอร์ Summarize ถูกพักการใช้งานชั่วคราวระหว่างปรับปรุงคุณภาพ จึงยังไม่มีปุ่มสร้างสรุปที่ใช้งานจริงในรุ่นนี้

### การติดตั้ง

#### ผ่าน SillyTavern

1. เปิด SillyTavern → **Extensions** → **Install Extension**
2. วาง URL:

   ```text
   https://github.com/mangkoodkung/context-usage-meter
   ```

3. รีเฟรช SillyTavern

#### ติดตั้งแบบ Manual

คัดลอกโฟลเดอร์โปรเจกต์ไปที่:

```text
SillyTavern/data/default-user/extensions/context-usage-meter
```

จากนั้นรีเฟรช SillyTavern

### วิธีใช้

1. เปิดหน้า Extensions แล้วเปิดใช้งาน Context Usage Meter
2. เลือก Context Size จากตัวช่วยครั้งแรก หรือใช้ค่าปัจจุบันของ SillyTavern
3. เลือกรูปแบบมิเตอร์และชุดสีที่ต้องการ
4. ส่งข้อความตามปกติ มิเตอร์จะอัปเดตจากพรอมท์จริงก่อนส่งไปยังโมเดล
5. แตะหรือคลิกมิเตอร์เพื่อดูรายละเอียด token

### การตั้งค่าหลัก

- เปิด/ปิดมิเตอร์และการแจ้งเตือน
- Context Size จริงของ SillyTavern
- เกณฑ์เตือน 50–80%
- Response Reserve (`0` = อ่านจาก SillyTavern อัตโนมัติ)
- รูปแบบและขนาดมิเตอร์
- ไอคอน Floating Orb และตัวละคร Familiar
- ชุดสีสำเร็จรูป สี Custom และชุดสีที่บันทึกไว้

### ติดต่อ

Discord: **majesty.pop (POPKO)**

---

## English

**Context Usage Meter** shows how much of the context window the real outgoing prompt uses, how much room remains for the model's reply, and warns before an oversized conversation begins causing empty or failed responses.

> Supports **Chat Completion**, including OpenAI, Claude, and Gemini.

### Features

- **Real-time metering:** Counts the actual outgoing prompt and displays usage percentage, Context Size, and Response Reserve.
- **Threshold warnings:** Configure warnings from 50–80%. A warning appears once per threshold crossing and remains dismissible.
- **Safe Context Size:** Updates SillyTavern's actual Context Size, with Flash 90k, Pro 200k, and custom options.
- **First-run setup assistant:** Select a profile on first use or reopen the assistant from Settings at any time.
- **High-value confirmation:** Values above 200,000 tokens require confirmation; SillyTavern's Context Unlock is enabled when needed.
- **Basic styles:** Slim bar, capsule, and segmented blocks.
- **Advanced styles:** Ring, numeric badge, Floating Orb, Context Familiar, Magic Constellation, Edge Bookmark, and Ambient Aura.
- **Advanced meter sizing:** Scale supported Advanced meters from 50–120%; Ambient Aura remains unchanged.
- **Floating meters:** Drag to reposition, snap to screen edges, and fade while idle.
- **Context Familiar:** Twelve characters with mood changes based on context pressure.
- **Color themes:** Built-in palettes plus reusable custom color sets.
- **Responsive UI:** Settings, details, and floating elements adapt to desktop and mobile screens.

### Summarize status

Summarize is temporarily paused while its output quality is being improved. This release does not expose functional summary controls.

### Installation

#### Through SillyTavern

1. Open SillyTavern → **Extensions** → **Install Extension**.
2. Paste:

   ```text
   https://github.com/mangkoodkung/context-usage-meter
   ```

3. Refresh SillyTavern.

#### Manual installation

Copy the project folder to:

```text
SillyTavern/data/default-user/extensions/context-usage-meter
```

Then refresh SillyTavern.

### Usage

1. Enable Context Usage Meter from the Extensions panel.
2. Choose a Context Size in the first-run assistant or keep SillyTavern's current value.
3. Select a meter style and color theme.
4. Send messages normally. The meter updates from the real prompt immediately before it is sent.
5. Tap or click the meter to view the token breakdown.

### Main settings

- Meter and warning toggles
- SillyTavern's actual Context Size
- Warning threshold from 50–80%
- Response Reserve (`0` = read automatically from SillyTavern)
- Meter style and Advanced meter scale
- Floating Orb icon and Familiar character
- Preset, custom, and saved color themes

### Contact

Discord: **majesty.pop (POPKO)**

---

## License and credits

This project uses the terms in [LICENSE](./LICENSE). Commercial or for-profit use is not permitted; forks and modifications shared back to the community must retain credit.

- Extension: **POPKO (majesty.pop)**
- Original recap prompt: **xo.nara** (`recap-prompt.txt`; recap UI is currently paused)

*Created with care. ✨*

# 📊 Context Usage Meter

🇹🇭 [ภาษาไทย](#-thai) · 🇬🇧 [English](#-english)

A meter + warning extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) that shows exactly how full your context window is each round — and warns you *before* the prompt grows so large the model has no room left to reply.

---

<a id="-thai"></a>

## 🇹🇭 Thai

**Context Usage Meter** คือหลอดวัดการใช้ context แบบเรียลไทม์สำหรับ SillyTavern มันบอกว่าแต่ละรอบคุณส่งไปกี่ token จากเพดานที่ตั้งไว้ และ **เตือนชัดๆ ก่อนที่พรอมท์จะโตจนไม่เหลือที่ให้โมเดลตอบ** (ต้นเหตุของอาการ "ทำไมเจนไม่ออก / ตอบว่างๆ") พร้อมปุ่มสรุปเนื้อหาทั้งบทเป็น EN + TH ไว้อ่าน/ก็อป/ย้ายไปแชทใหม่

> 💡 รองรับ **Chat Completion** (เช่น OpenAI, Claude, Gemini)

### ✨ จุดเด่น

- **📊 หลอดวัดสด:** เห็นทันทีว่ารอบนี้ส่งไปกี่ token / เพดานเท่าไหร่ / กี่ % แตะที่หลอดเพื่อดู breakdown (system prompt vs user/assistant · ที่ว่าง · พื้นที่กันไว้ตอบ)
- **🚨 เตือนก่อนเจนไม่ออก:** หลอดมี "โซนกันไว้ให้คำตอบ" (สีส้ม) ถ้าพรอมท์ล้ำเข้าไป = แดง + เด้งเตือนทันที เพราะนั่นคือจุดที่โมเดลจะเริ่มตอบไม่ออกจริงๆ
- **🔄 ตามค่าจริงของ ST:** อ่านขนาด context + ความยาวคำตอบจากตัวตั้งค่าของ SillyTavern โดยตรง ปรับตรงไหนหลอดขยับตาม (พิมพ์เลข / ลากสไลเดอร์ / โหลด preset)
- **📝 สรุปเนื้อหาทั้งหมด (EN + TH):** กดปุ่มเดียว โมเดลสรุปทั้งบทเป็นสองภาษา เด้ง popup มีแท็บ English / ไทย + ปุ่มคัดลอก + เปิดสรุปล่าสุดซ้ำได้ (ไม่แตะข้อความเดิม)
- **🎨 ชุดสีหลอด:** เลือกได้หลายธีม (เบสิค, ม่วงชมพู, มินต์, พีช, ค็อตตอนแคนดี้, กาแล็กซี, นีออน, พาสเทล, โอเชียน, โมโนโครม) หรือ **กำหนดเอง** เลือกสีทีละช่อง + บันทึกได้หลายชุด
- **📱 ใช้ได้ทุกจอ:** หลอดบางไม่เกะกะบนมือถือ แตะเพื่อกางดูรายละเอียด popup จัดกึ่งกลางถูกต้องทุกแพลตฟอร์ม

### 🛠️ การติดตั้ง

**วิธีที่ 1 — ผ่าน SillyTavern (ง่ายสุด):**

1. เปิด SillyTavern → แผง Extensions → **Install Extension**
2. วาง URL นี้:

   ```
   https://github.com/mangkoodkung/context-usage-meter
   ```

3. รีเฟรช SillyTavern

**วิธีที่ 2 — Manual:** คัดลอกโฟลเดอร์ `context-usage-meter` ไปไว้ที่ `SillyTavern/public/scripts/extensions/third-party/context-usage-meter` แล้วรีเฟรช

> ต้องมี extension **Summarize** ในตัว ST เปิดไว้ เพื่อผลลัพธ์การสรุปที่ดีที่สุด

### 💡 วิธีใช้

1. หลอดจะโผล่เหนือช่องพิมพ์ ส่งข้อความ 1 รอบแล้วมันจะเริ่มแสดงค่า — แตะที่หลอดเพื่อดูตัวเลขเต็ม
2. เมื่อพรอมท์ใกล้เต็ม หลอดจะเปลี่ยนสี + เด้งเตือน (ตั้งเกณฑ์ % ได้ในตั้งค่า)
3. กด **"สรุปเนื้อหาทั้งหมด (EN+TH)"** ในแผงตั้งค่า (หรือปุ่มที่โผล่ตอนเตือน) เพื่อสรุปทั้งบท → ก็อป/เซฟไปเริ่มแชทใหม่
4. ปรับ **ชุดสีหลอด** ตามชอบ หรือเลือก **กำหนดเอง** เพื่อจิ้มสีเอง + บันทึกชุดไว้

### ⚙️ การตั้งค่า

เปิด/ปิดหลอด · เปิด/ปิดการเตือน · เกณฑ์ % เตือน · Response Reserve (0 = อ่านจาก ST อัตโนมัติ) · ชุดสีหลอด + สีกำหนดเอง (บันทึกหลายชุดได้)

### 🔧 ติดต่อ

**Discord: majesty.pop (POPKO)**

### 📜 License & Terms of Use

โปรเจกต์นี้ใช้ **Custom License** ดูฉบับเต็มที่ไฟล์ [LICENSE](./LICENSE)

> [!WARNING]
> **สำคัญมาก (CRITICAL):** โปรเจกต์นี้สร้างเพื่อแบ่งปันให้คอมมูนิตี้ใช้ฟรี
>
> 1. ✅ **อนุญาต:** Fork / ดัดแปลง / พัฒนาต่อ เพื่อแจกจ่ายคืนคอมมูนิตี้
> 2. ❌ **ห้าม:** นำไปใช้เชิงพาณิชย์หรือแสวงหากำไรทุกรูปแบบ
> 3. ❌ **ห้าม:** ปิดซอร์สโค้ด หรือดัดแปลงเพื่อจำหน่าย
> 4. ⚠️ **ต้อง:** ให้เครดิตว่ามาจาก Context Usage Meter โดย POPKO

---

<a id="-english"></a>

## 🇬🇧 English

**Context Usage Meter** is a real-time context gauge for SillyTavern. It shows how many tokens you send each round out of your configured limit, and **warns you clearly before the prompt grows so large the model has no room left to reply** (the real cause of "why won't it generate / it returns nothing"). It also generates a full bilingual (EN + TH) recap of the whole chat for you to read, copy, or carry into a fresh chat.

> 💡 Supports **Chat Completion** (e.g. OpenAI, Claude, Gemini)

### ✨ Features

- **📊 Live meter:** See at a glance how much you sent this round / the max context / the percentage. Tap the bar for a breakdown (system prompt vs user/assistant · free space · reserved reply space).
- **🚨 Warns before empty generations:** The bar shows a "reserved-for-reply" zone (amber). If the prompt crosses into it → red + instant warning, because that's exactly when the model starts failing to reply.
- **🔄 Follows ST's real values:** Reads context size + response length straight from SillyTavern's settings, so the bar tracks any change (typed number / slider / preset load).
- **📝 Full recap (EN + TH):** One click and the model summarizes the entire chat in both languages, shown in a popup with English / Thai tabs + a copy button + reopen-last (never touches your existing messages).
- **🎨 Bar color themes:** Pick from many themes (Basic, Sakura, Mint, Peach, Cotton Candy, Galaxy, Neon, Pastel, Ocean, Mono) or go **Custom** — choose each color and save multiple sets.
- **📱 Works everywhere:** A slim bar that stays out of the way on mobile, tap to expand; the recap popup is correctly centered on every platform.

### 🛠️ Installation

**Option 1 — via SillyTavern (easiest):**

1. Open SillyTavern → Extensions panel → **Install Extension**
2. Paste this URL:

   ```
   https://github.com/mangkoodkung/context-usage-meter
   ```

3. Refresh SillyTavern.

**Option 2 — Manual:** Copy the `context-usage-meter` folder into `SillyTavern/public/scripts/extensions/third-party/context-usage-meter`, then refresh.

> Keep SillyTavern's built-in **Summarize** extension enabled for the best recap results.

### 💡 Usage

1. The bar appears above the input box. Send one message and it starts showing values — tap the bar for full numbers.
2. As the prompt fills up, the bar changes color and a warning pops (threshold % is configurable).
3. Click **"สรุปเนื้อหาทั้งหมด (EN+TH)"** in the settings panel (or the button that appears on warning) to summarize the whole chat → copy/save it to seed a new chat.
4. Adjust the **bar color theme**, or pick **Custom** to choose your own colors and save sets.

### ⚙️ Settings

Enable/disable the meter · toggle warnings · warning threshold % · Response Reserve (0 = auto-read from ST) · bar color theme + custom colors (multiple saved sets).

### 🔧 Contact

**Discord: majesty.pop (POPKO)**

### 📜 License & Terms of Use

This Extension uses a **Custom License**. See the full terms in the [LICENSE](./LICENSE) file.

> [!WARNING]
> **CRITICAL:** This project was created to be shared freely with the community.
>
> 1. ✅ **Allowed:** Fork / modify / develop further to share back with the community
> 2. ❌ **Forbidden:** Any commercial or for-profit use
> 3. ❌ **Forbidden:** Closing the source or selling derivatives
> 4. ⚠️ **Required:** Credit Context Usage Meter by POPKO

---

## 🙏 Credits

- **Extension:** POPKO (majesty.pop)
- **Summarizer (Recap) prompt:** [xo.nara](https://github.com/) — bundled as `recap-prompt.txt` with credit

---
*Created with care. ✨*

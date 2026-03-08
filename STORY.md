# Our Story — Aki

*What inspired us, what we learned, how we built it, and the challenges we faced.*

---

## What inspired us

We wanted to help people **reconnect with Indigenous foodways**—not as a history lesson, but as something you can do in your own kitchen. So many of us are disconnected from where our food comes from and from the knowledge that Indigenous cultures have carried for generations.

We were inspired by the **Three Sisters** (squash, beans, corn) and by the idea that a photo of your counter could become a doorway: to Ojibwe names, to traditional recipes, and to a guided cooking experience that feels both modern (AI, 3D, voice) and rooted. We built Aki so that *"what's in my kitchen?"* leads to *"how do I cook this with respect and care?"*

---

## What we learned

We learned how to **weave multiple AI and media services** into one flow: Cloudinary for storage and object detection (LVIS), Gemini for Indigenous context and analysis, ElevenLabs for natural-sounding step-by-step voice.

We learned how to structure a 3D cooking tutorial as a **sequence of step modules**. Conceptually, the flow is:

\[
\text{splash} \rightarrow \text{upload} \rightarrow \text{detect} \rightarrow \text{recipe} \rightarrow \text{kitchen3d}
\]

and inside the kitchen, steps are ordered as:

\[
\text{chop} \rightarrow \text{dice} \rightarrow \text{mince} \rightarrow \text{pour} \rightarrow \text{boil} \rightarrow \text{add veggies} \rightarrow \text{add beans \& corn} \rightarrow \text{stir \& reveal}
\]

so the experience stays smooth and predictable. We also learned how important it is to keep Indigenous context **accurate and respectful**—surfacing nation and territory, using recipe and story data carefully, and letting the food and the process lead.

---

## How we built it

We started with a **Node + Express** backend and a **vanilla JS** frontend (no framework) so we could move fast and keep the stack simple.

**Upload pipeline:**

\[
\text{File} \xrightarrow{\text{Multer}} \text{Cloudinary (upload + LVIS)} \xrightarrow{\text{Gemini}} \text{analysis + context} \xrightarrow{\text{recipe-matcher}} \text{suggestedRecipes}
\]

The frontend is a single-page app: splash (with a 3D hero), nation picker, upload, detection, recipe list with a *View 3D Kitchen* button, and the 3D kitchen screen. The kitchen is a **Three.js** scene that loads GLB models for ingredients, a cutting board, pot, and finished stew; `CookingGuide` runs an 8-step overlay and coordinates step modules (Step1Chop through Step8Stir). Each step can speak via **ElevenLabs TTS**, and we added **voice control** so users can say *"next"* or *"continue"* to advance. Story narration and an AR storyboard (CookingAR) round out the experience.

---

## Challenges we faced

| Area | Challenge |
|------|-----------|
| **APIs** | Cloudinary, Gemini, ElevenLabs (and optionally Hugging Face) had different auth, rate limits, and response shapes. We had to normalize errors, handle missing keys gracefully, and keep the UI responsive while waiting on external calls. |
| **3D choreography** | Making chop, dice, mince, pour, boil, and stir feel consistent meant building separate step modules with clear phases (e.g. board in \(\rightarrow\) ingredient to board \(\rightarrow\) knife animation \(\rightarrow\) pile reveal \(\rightarrow\) board out). Syncing visibility and positions (cutting board, pot, stew) across steps and keeping performance smooth was tricky. |
| **Merging versions** | We had one branch focused on recipe list, 3D button, and voice, and another with the "finish" (pot, stew, full 8-step flow). Combining them required carefully bringing over new assets and step modules without breaking the existing flow. |
| **Voice & accessibility** | We wanted *Listen* and voice *next/continue* to work across browsers; we had to handle Web Speech API support and fallbacks and keep TTS and UI in sync. |

---

*You can change this story later. Render this Markdown with a LaTeX-capable viewer (e.g. many static site generators, or export to PDF with `pandoc`) to see the math.*

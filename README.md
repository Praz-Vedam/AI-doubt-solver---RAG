# Video Knowledge Chatbot

Production-quality POC for a **vectorless RAG** chatbot that answers questions **only** from uploaded video transcripts.

- No vector databases
- No embeddings
- No semantic search
- PageIndex-style hierarchical tree index stored in PostgreSQL

## Features

- Upload educational videos
- Extract audio with `ffmpeg`
- Transcribe locally with Transformers.js Whisper (or OpenAI Whisper API)
- Build a hierarchical topic tree (PageIndex-style) with summaries and timestamps
- Store tree nodes in PostgreSQL (`TranscriptNode`)
- Retrieve with LLM reasoning over the tree index (not keyword top-K)
- Answer with strict transcript-only prompts
- Stream chat responses with sources, confidence, and timestamps
- Visual page-index bar in the transcript panel

## Tech Stack

- Next.js 16 App Router
- React 19 + TypeScript + Tailwind CSS
- PostgreSQL + Prisma
- Local Whisper via `@huggingface/transformers`
- Ollama (`gemma4:26b`) via hosted ngrok endpoint for LLM

## Prerequisites

- Node.js 20+
- npm
- Docker (for PostgreSQL)
- ffmpeg + ffprobe

Install ffmpeg on macOS:

```bash
brew install ffmpeg
```

## Local Setup

1. Clone or open the project:

```bash
cd /Users/vedam/video-knowledge-chatbot
```

2. Install dependencies:

```bash
npm install --legacy-peer-deps
```

3. Copy environment variables:

```bash
cp .env.example .env
```

4. Start PostgreSQL:

```bash
docker compose up -d
```

5. Create the database and run migrations:

```bash
npm run db:setup
```

If you prefer interactive migration development, use `npm run db:migrate` after `db:setup`.

6. Start the app:

```bash
npm run dev
```

7. Open:

```text
http://localhost:3000/ai
```

## Environment Variables

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `LLM_PROVIDER` | `ollama` (default), `openrouter`, or `openai` |
| `LLM_INDEX_PROVIDER` / `LLM_INDEX_MODEL` | Optional override for the indexing LLM (open-source) |
| `LLM_CHAT_PROVIDER` / `LLM_CHAT_MODEL` | Optional override for the query-time LLM (cloud, token-based) |
| `RAG_TOP_K` | Top-k page-index nodes injected into chat context (default 5) |
| `OLLAMA_BASE_URL` | Hosted Ollama base URL (default: ngrok endpoint) |
| `OLLAMA_API_KEY` | Placeholder key for Ollama OpenAI-compatible API |
| `LLM_MODEL` | Ollama model name, e.g. `gemma4:26b` |
| `OPENROUTER_API_KEY` | Required only when `LLM_PROVIDER=openrouter` |
| `OPENAI_API_KEY` | Required for OpenAI LLM or OpenAI Whisper |
| `WHISPER_PROVIDER` | `local`, `openai`, or `hosted` |
| `WHISPER_BASE_URL` | Self-hosted Whisper base URL (required when `hosted`), e.g. ngrok tunnel |
| `WHISPER_TRANSCRIBE_PATH` | Hosted transcribe path (default `/transcribe`) |
| `WHISPER_MODEL` | Local model, e.g. `Xenova/whisper-small.en` |
| `UPLOAD_DIR` | Default `uploads/videos` |

## API Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/videos/upload` | Upload a video and start transcription |
| `POST` | `/api/videos/transcribe` | Re-run transcription for a video |
| `GET` | `/api/videos` | List uploaded videos |
| `POST` | `/api/chat` | Ask a question |
| `GET` | `/api/chat/history?sessionId=` | Fetch chat history |
| `POST` | `/api/search` | Debug transcript search |

## Architecture

```text
Upload -> ffmpeg (16kHz mono m4a) -> silence-aware ~10min chunks
       -> Whisper API in parallel batches (timestamps offset, prompt-stitched)
       -> raw segments persisted as <video>.segments.json (transcribe once)
       -> timed blocks (full text) -> LLM topic tree -> TranscriptNode (PostgreSQL)
Question -> LLM tree search (titles + summaries) -> node text -> grounded answer
```

Long transcripts (> ~1 hr) are indexed map-reduce style: one Ollama call per
~12 min window over full text, then one call to group leaves into chapters.
Stored node text is never truncated; truncation applies only to LLM prompts.

## Strict Answering

If the answer is not directly supported by retrieved transcript sections, the system returns:

```text
Information not found in uploaded content.
```

## Project Structure

```text
src/
  app/
    ai/
    api/
  components/
    ai/
    ui/
  lib/
  services/
  types/
prisma/
uploads/videos/
```

## Notes

- First local Whisper run downloads the model and can take several minutes.
- Transcription runs in the background after upload.
- Select one or more videos in the UI to scope chat search; leave unselected to search all ready videos.

## Scripts

```bash
npm run dev
npm run build
npm run db:migrate
npm run db:studio
```

## Transcripts (from DB)

### Output

#### [0:00 - 2:05] Introduction to Output

Section 1: Hello everyone, welcome to another lecture of codes print, I am your instruct... 0:00 - 5:21 Hello everyone, welcome to another lecture of codes print, I am your instructor SKSAR and in today's lecture we are going to study about output. So what does that mean? So let us jump to the Notability screen. So in last class what we did is we understood why or how we code, right, how or where to be precise, where we code, right and why we code, ultimately build a software, right. Now think about a software, right, let us say you are trying to build a software, what are the things that are …

#### [2:05 - 8:20] The Software Workflow

three part to it. What are those three part? The very first part is simple. You are going to take some input. So any software, you pick any software, let's say, chat GPT. What happens? Chagipiti takes an input. Zomato, Zomato takes an input. What food do you want to order? That is something that you choose, Chagipiti. What is it that, what's the question of which the answer you are looking for? Any weather app on which day are you, do you want to predict the weather. So anything that you do in a software, there is some kind of input that user provides, right? Now, oops, why is it closed? Okay,… you will have to provide input. Then software will do some kind of processing, depends on the software that you are using, some kind of processing, whether app, some kind of logic could be there to predict the weather on Thursday next week, chargeability to figure out what is the answer of the question that you ask. Anything that you will pick, there is going to be some processing to the query that you just gave and then ultimately that software is going to give you output. Chagipiti, the answer that Chagipiti figured out, chagipiti is going to show it to you, right. Then zomato, you ordered s… assigned some delivery boy and then showed to you, okay, okay, the order has been confirmed. So that output thing after processing, there is ultimately going to be some kind of output in almost all the software right. So software consists of these three steps, more or less right there might be some extra stuff to it but more or less these three steps are going to be there right. So if we ultimately want to build this and coding is nothing about the building block of it right, we need to think about these three sections right. Now this processing part we are going to pick at the very last or ma…

#### [8:20 - 10:25] Complexity of Software Logic

of technology. So this is the part which will take you like, I do not know, like 400 hours maybe to excel absolutely right. How do you process, this is the core logic of your software basically. These two things, these two things are relatively easy and quick to understand even though these two things are also very important right but these are fixed step basically as long as you know what output, what to show, showing it is easiest part I think right. Then as long as you no care what you want as input, just taking the input is the easiest part, right? Figuring out how to solve that complex pr…

#### [10:25 - 12:30] Java Output Syntax

to learn these two, okay? How do you output and how do you input something, right? Let's start with output. So for output, all you do, all you need is to remember just one line. System.out.printLnWethem. That's it, double quote. Okay. dot print ln VEDAM that's it double code okay and let's not go to VEDAM directly let's start with some number let's say 20 let's say, remember, remember, this again, you know there is rule, syntax in Java. So this is the very first syntax, the first rule that you are learning. If you want to print something, show it output wise, right, this is what you will write…

### Lec 2 - Output 1

#### [0:01 - 2:06] Software Development Overview

Hello everyone, welcome to another lecture of code sprint. I am your instructor SK sir and in today's lecture we are going to study about output. So what does that mean? Okay, so let's jump to the notability screen. Okay, so in last class what we did is we understood why or how we code right, how or where to be precise, where we code right and why we code. Ultimately build a software right. Now think about a software right. Let's say you are trying to build a software. What are the things that are required in a software? So if you think about it, software has three parts to it. What are those three parts? The very first part is simple. Here you are going to take some input. So any software, you pick any software, let's say ChatGPT. What happens? ChatGPT takes an input. Zomato, Zomato takes an input. What food do you want to order? That is something that you choose, ChatGPT. What is it that the, what's the question of which the answer you are looking for? Any weather app, on which day do you want to predict the weather? So anything that you do in a software, there is some kind of input that user provides right. Now, oops, why is it closed? Okay, so now the first part is input, of course. There is software, you will have to provide input. Then software will do some kind of processing. No, it depends on the software that you are using. Some kind of processing, weather app, some kind of logic would be there to predict the weather on Thursday next week. ChatGPT to figure out what is the answer of the question that you asked.

#### [2:06 - 4:11] The Role of Output in Applications

Anything that you will pick, there is going to be some processing to the query that you just gave. And then ultimately, that software is going to give you output. ChatGPT, answer, the answer that ChatGPT figured out, ChatGPT is going to show it to you, right. Then Zomato, you ordered something, right, then it processed everything, processed as in it transferred that order to the restaurant, then some assigned some delivery boy and then showed to you, okay, the order has been confirmed. So that output thing, after processing, there is ultimately going to be some kind of output in almost all the software, right. So software consists of these three steps, more or less, right. There might be some extra stuff to it, but more or less, these three steps are going to be there, right. So if you ultimately want to build this, and coding is nothing about the building block of it, right, so we need to think about these three sections, right. Now, this processing part, we are going to pick at the very last, or maybe not in this course, maybe when you will join Vedam School of Technology, so this is the part which will take you like, I don't know, like 400 hours maybe, to excel absolutely, right. How do you process, this is the core logic of your software basically, right. These two things, these two things are relatively easy and quick to understand, even though these two things are also very important, right, but these are fixed step basically. As long as you know what to output, what to show, showing it is easiest part, I think, right. Then as long as you know what you want as input, just taking the input is easiest part, right. Figuring out how to solve that complex problem, that is the trickiest part. So for now,

#### [4:11 - 12:22] Java Syntax for Printing

we are going to learn these two, okay, that how do you output and how do you input something, right. Okay, so let us start with output. So, for output, all you do, all you need is to remember just one line, system.out.println vedam, that is it, double quote. Okay, let us not go to vedam directly, let us start with some number, let us say 20. Let us say 20. So again, remember, remember, this again, you know, there is a rule, syntax in Java. So this is the very first syntax, the first rule that you are learning. If you want to print something, show it output wise, right, this is what you will write, what, system where S is a capital, then out.println. So, let us say 20. So, you can see 20, we have a set of values,

#### [12:22 - 12:44] Numerical Output Demonstration

20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s,

## Transcripts (from DB)

### Output

#### [0:00 - 2:05] Introduction to Output

Section 1: Hello everyone, welcome to another lecture of codes print, I am your instruct... 0:00 - 5:21 Hello everyone, welcome to another lecture of codes print, I am your instructor SKSAR and in today's lecture we are going to study about output. So what does that mean? So let us jump to the Notability screen. So in last class what we did is we understood why or how we code, right, how or where to be precise, where we code, right and why we code, ultimately build a software, right. Now think about a software, right, let us say you are trying to build a software, what are the things that are …

#### [2:05 - 8:20] The Software Workflow

three part to it. What are those three part? The very first part is simple. You are going to take some input. So any software, you pick any software, let's say, chat GPT. What happens? Chagipiti takes an input. Zomato, Zomato takes an input. What food do you want to order? That is something that you choose, Chagipiti. What is it that, what's the question of which the answer you are looking for? Any weather app on which day are you, do you want to predict the weather. So anything that you do in a software, there is some kind of input that user provides, right? Now, oops, why is it closed? Okay,… you will have to provide input. Then software will do some kind of processing, depends on the software that you are using, some kind of processing, whether app, some kind of logic could be there to predict the weather on Thursday next week, chargeability to figure out what is the answer of the question that you ask. Anything that you will pick, there is going to be some processing to the query that you just gave and then ultimately that software is going to give you output. Chagipiti, the answer that Chagipiti figured out, chagipiti is going to show it to you, right. Then zomato, you ordered s… assigned some delivery boy and then showed to you, okay, okay, the order has been confirmed. So that output thing after processing, there is ultimately going to be some kind of output in almost all the software right. So software consists of these three steps, more or less right there might be some extra stuff to it but more or less these three steps are going to be there right. So if we ultimately want to build this and coding is nothing about the building block of it right, we need to think about these three sections right. Now this processing part we are going to pick at the very last or ma…

#### [8:20 - 10:25] Complexity of Software Logic

of technology. So this is the part which will take you like, I do not know, like 400 hours maybe to excel absolutely right. How do you process, this is the core logic of your software basically. These two things, these two things are relatively easy and quick to understand even though these two things are also very important right but these are fixed step basically as long as you know what output, what to show, showing it is easiest part I think right. Then as long as you no care what you want as input, just taking the input is the easiest part, right? Figuring out how to solve that complex pr…

#### [10:25 - 12:30] Java Output Syntax

to learn these two, okay? How do you output and how do you input something, right? Let's start with output. So for output, all you do, all you need is to remember just one line. System.out.printLnWethem. That's it, double quote. Okay. dot print ln VEDAM that's it double code okay and let's not go to VEDAM directly let's start with some number let's say 20 let's say, remember, remember, this again, you know there is rule, syntax in Java. So this is the very first syntax, the first rule that you are learning. If you want to print something, show it output wise, right, this is what you will write…

### Lec 2 - Output 1

#### [0:01 - 2:06] Software Development Overview

Hello everyone, welcome to another lecture of code sprint. I am your instructor SK sir and in today's lecture we are going to study about output. So what does that mean? Okay, so let's jump to the notability screen. Okay, so in last class what we did is we understood why or how we code right, how or where to be precise, where we code right and why we code. Ultimately build a software right. Now think about a software right. Let's say you are trying to build a software. What are the things that are required in a software? So if you think about it, software has three parts to it. What are those three parts? The very first part is simple. Here you are going to take some input. So any software, you pick any software, let's say ChatGPT. What happens? ChatGPT takes an input. Zomato, Zomato takes an input. What food do you want to order? That is something that you choose, ChatGPT. What is it that the, what's the question of which the answer you are looking for? Any weather app, on which day do you want to predict the weather? So anything that you do in a software, there is some kind of input that user provides right. Now, oops, why is it closed? Okay, so now the first part is input, of course. There is software, you will have to provide input. Then software will do some kind of processing. No, it depends on the software that you are using. Some kind of processing, weather app, some kind of logic would be there to predict the weather on Thursday next week. ChatGPT to figure out what is the answer of the question that you asked.

#### [2:06 - 4:11] The Role of Output in Applications

Anything that you will pick, there is going to be some processing to the query that you just gave. And then ultimately, that software is going to give you output. ChatGPT, answer, the answer that ChatGPT figured out, ChatGPT is going to show it to you, right. Then Zomato, you ordered something, right, then it processed everything, processed as in it transferred that order to the restaurant, then some assigned some delivery boy and then showed to you, okay, the order has been confirmed. So that output thing, after processing, there is ultimately going to be some kind of output in almost all the software, right. So software consists of these three steps, more or less, right. There might be some extra stuff to it, but more or less, these three steps are going to be there, right. So if you ultimately want to build this, and coding is nothing about the building block of it, right, so we need to think about these three sections, right. Now, this processing part, we are going to pick at the very last, or maybe not in this course, maybe when you will join Vedam School of Technology, so this is the part which will take you like, I don't know, like 400 hours maybe, to excel absolutely, right. How do you process, this is the core logic of your software basically, right. These two things, these two things are relatively easy and quick to understand, even though these two things are also very important, right, but these are fixed step basically. As long as you know what to output, what to show, showing it is easiest part, I think, right. Then as long as you know what you want as input, just taking the input is easiest part, right. Figuring out how to solve that complex problem, that is the trickiest part. So for now,

#### [4:11 - 12:22] Java Syntax for Printing

we are going to learn these two, okay, that how do you output and how do you input something, right. Okay, so let us start with output. So, for output, all you do, all you need is to remember just one line, system.out.println vedam, that is it, double quote. Okay, let us not go to vedam directly, let us start with some number, let us say 20. Let us say 20. So again, remember, remember, this again, you know, there is a rule, syntax in Java. So this is the very first syntax, the first rule that you are learning. If you want to print something, show it output wise, right, this is what you will write, what, system where S is a capital, then out.println. So, let us say 20. So, you can see 20, we have a set of values,

#### [12:22 - 12:44] Numerical Output Demonstration

20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s, 20s,

# Champagne Coast — Interactive Stem Analysis

This is my final project for MUSIC 159 - Analyzing Popular Music after 2000. It is an interactive, web-based analytical tool and essay that explores the timbral and spatial construction of Blood Orange's "Champagne Coast" (2011).

## Features

- **Interactive Stems Player:** A custom Web Audio API player that isolates the song into 5 separate stems (Vocals, Hi-Hat, Bass, Melody, Kick).
- **Live Spectrograms:** Real-time frequency visualization mapping for all audio components.
- **Embedded Audio Snippets:** The analytical report features inline audio snippets that let readers visualize and hear specific track moments in context.

## Running Locally

This project is entirely static and requires no build steps or backend servers. To view it locally, open a terminal in this directory and start a local HTTP server:

```bash
python3 -m http.server 8888
```

Then navigate to `http://localhost:8888` in your browser.

## Deployment

This project is designed to be hosted via GitHub Pages and can be accessed at https://sudsw12.github.io/MUSIC-159-Final-Project/

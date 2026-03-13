#!/bin/bash
#
# Setup local embedding model for mini-chris memory search.
# Works offline — no ollama pull needed.
#
# Usage:
#   cd models/
#   ./setup.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GGUF_FILE="$SCRIPT_DIR/all-MiniLM-L6-v2.Q4_K_M.gguf"
MODEL_NAME="all-minilm"

# Check ollama is installed
if ! command -v ollama &>/dev/null; then
  echo "Error: ollama is not installed."
  echo "Install from: https://ollama.com/download"
  exit 1
fi

# Check GGUF file exists
if [ ! -f "$GGUF_FILE" ]; then
  echo "Error: GGUF file not found at $GGUF_FILE"
  echo ""
  echo "Download it manually and place it in this directory:"
  echo "  File: all-MiniLM-L6-v2.Q4_K_M.gguf (~23MB)"
  echo "  From: https://huggingface.co/leliuga/all-MiniLM-L6-v2-GGUF/resolve/main/all-MiniLM-L6-v2.Q4_K_M.gguf"
  echo ""
  echo "Or copy from a colleague who already has it."
  exit 1
fi

# Create the model
echo "Creating Ollama model '$MODEL_NAME' from local GGUF file..."
cd "$SCRIPT_DIR"
ollama create "$MODEL_NAME" -f Modelfile

echo ""
echo "Done! Model '$MODEL_NAME' is now available."
echo "mini-chris will automatically use it for memory search."
echo ""
echo "Test it:"
echo "  mini-chris memory search \"test query\""

import * as ext1 from "./extension-1/index"
import * as ext2 from "./extension-2/index"

// Wrapping the whole extension in a JS function
// (ensures all global variables set in this extension cannot be referenced outside its scope)
(async function(codioIDE, window) {

  // ── EXTENSION SETUP ────────────────────────────────────────────────────────

  // Alias for convenience
  const coachAPI = codioIDE.coachBot
  // Register the top-level entry point for this extension
  coachAPI.register("contentAssistantsMenuButton", "Content Assistants Menu", showMenuButtons)

  function showMenuButtons() {
    coachAPI.showButton("1. Generate Learning Objectives", onAssistantOneButtonPress)
    coachAPI.showButton("2. Generate Alt Text for All Images", onAssistantTwoButtonPress)
  }

  async function onAssistantOneButtonPress() {
    await ext1.generateLearningObjectives()
    showMenuButtons()
  }

  async function onAssistantTwoButtonPress() {
    await ext2.startAltTextGeneration()
    showMenuButtons()
  }
// calling the function immediately by passing the required variables
})(window.codioIDE, window)

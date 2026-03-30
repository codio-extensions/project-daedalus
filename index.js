// Wrapping the whole extension in a JS function 
// (ensures all global variables set in this extension cannot be referenced outside its scope)
(async function(codioIDE, window) {
  
  // initialize coachBot client so it's easier to use
  const coachAPI = codioIDE.coachBot

  // register(id: unique button id, name: name of button visible in Coach, function: function to call when button is clicked) 
  coachAPI.register("contentAssistantsMenuButton", "Content Assistants Menu", onMenuButtonPress)
  
  // register(id: unique button id, name: name of button visible in Coach, function: function to call when button is clicked) 
  // codioIDE.coachBot.register("iNeedHelpButton", "I have a question", onButtonPress)

  // function called when I have a question button is pressed
  async function onMenuButtonPress() {

    coachAPI.showButton("1. Generate Learning Objectives", onAssistantOneButtonPress)
    coachAPI.showButton("2. Generate Alt Text for All Images", onAssistantTwoButtonPress)
    
  }

  async function onAssistantOneButtonPress() {
    coachAPI.showThinkingAnimation()
    coachAPI.write("Learning Objectives Generated")
    coachAPI.hideThinkingAnimation()
    coachAPI.showMenu()
  }

  async function onAssistantTwoButtonPress() {
    coachAPI.showThinkingAnimation()
    coachAPI.write("Alt Text Generated")
    coachAPI.hideThinkingAnimation()
    coachAPI.showMenu()
  }

// calling the function immediately by passing the required variables
})(window.codioIDE, window)

 

  
  

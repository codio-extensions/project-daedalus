// Refer to Anthropic's guide on system prompts: https://docs.anthropic.com/claude/docs/system-prompts
const learningObjSystemPrompt = `
  You are a helpful teaching assistant.
  Your task is to generate learning objectives for an assignment using the following template:

  <template>
    ### Learners will be able to...

    * ### Learning objectives
    * ### Go here
    * ### Should read like test question

    |||guidance
    ## Assumptions
    [What do we expect the students to already know]

    ## Limitations
    [What might not be covered, or design decisions made by Codio, ending with a new line character]

    |||

    </template>
    Note:
    - Make sure to use the format as a template for the learning objectives you generate.
    - Make sure there is a new line before the last ||| of the guidance tag.
    - Make sure all the bullet points start with a ### for bold markdown formatting as per the template provided.
    - Do not stray away from the template and respond with the learning objectives page inside the <learning_objectives> tag.
    `

const learningObjectivesPrompt = `
    Here is the assignment content. Read it carefully and generate the learning objectives page:

    <assignment_content>
    {{CONTENT}}
    </assignment_content>

    Note:
    - Keep the bullet points to 1-5 learning objectives that cover all the pages in the assignment content.
    - Make sure all the bullet points start with a ### for markdown formatting as per the template provided.
    `

export async function generateLearningObjectives() {
  const guidePages = await fetchAssignmentPages()

  // Concatenate all page content into a single string for LLM context
  let concatenatedPages = ""
  for (const pageData of Object.values(guidePages)) {
    concatenatedPages += pageData.content
  }
  console.log(concatenatedPages)

  codioIDE.coachBot.write(`Generating Learning Objectives ... please wait...`)
  coachAPI.showThinkingAnimation()
  const userPrompt = learningObjectivesPrompt.replace('{{CONTENT}}', concatenatedPages)

  const generatedContent = await fetchLLMResponseXMLTagContents(learningObjSystemPrompt, userPrompt, "learning_objectives")
  console.log("Generated Learning Objective result", generatedContent)

  await addPageToGuide('Learning Objectives', generatedContent)
  coachAPI.hideThinkingAnimation()
  codioIDE.coachBot.write(`Learning Objectives page generated successfully!`)
}

// Fetches all guide pages except any that are (or look like) an existing learning objectives page.
// Returns an object keyed by index with { title, id, content } for each qualifying page.
async function fetchAssignmentPages() {
  // Skip pages whose titles match any of these patterns — they're already LO pages
  const excludedKeywords = [
    "learning objectives", "learning_objectives", "LearningObjectives", "Learning_Objectives", "learning-objectives",
    "Learning-Objectives", "LearningObjectives---", "Objectives_Learning", "Objectives-Learning", "learningobjectives",
    "LO_", "LO-", "Learning_Obj", "LearningObj", "Objectives", "LOs"
  ]

  let guidesStructure
  try {
    guidesStructure = await window.codioIDE.guides.structure.getStructure()
    console.log("This is the Guides structure", guidesStructure)
  } catch (e) {
    console.error(e)
  }

  const findPagesFilter = (obj) => {
    if (!obj || typeof obj !== 'object') return [];
    return [
      ...(obj.type === 'page' ? [obj] : []),
      ...Object.values(obj).flatMap(findPagesFilter)
    ];
  };

  const assignmentPages = findPagesFilter(guidesStructure)
  console.log("pages", assignmentPages)

  const guidePages = {}
  for (const element_index in assignmentPages) {
    const pageTitle = assignmentPages[element_index].title
    if (excludedKeywords.some(keyword => pageTitle.includes(keyword))) continue

    const page_id = assignmentPages[element_index].id
    const pageData = await codioIDE.guides.structure.get(page_id)
    guidePages[element_index] = { title: pageTitle, id: page_id, content: pageData.settings.content }
  }

  console.log("guide pages", guidePages)
  return guidePages
}

// Calls the LLM and extracts content between the given XML tags in the response
async function fetchLLMResponseXMLTagContents(systemPrompt, userPrompt, xml_tag) {
  const result = await codioIDE.coachBot.ask(
    {
      systemPrompt: systemPrompt,
      messages: [{ "role": "user", "content": userPrompt }]
    },
    { stream: false, preventMenu: true }
  )
  console.log("response", result.result)

  const startIndex = result.result.indexOf(`<${xml_tag}>`) + `<${xml_tag}>`.length
  const endIndex = result.result.lastIndexOf(`</${xml_tag}>`)

  return result.result.substring(startIndex, endIndex)
}

// Inserts a new page at the top of the guide (root parent, first position)
async function addPageToGuide(title, content) {
  let newPage
  try {
    newPage = await window.codioIDE.guides.structure.add({
      title: title,
      type: window.codioIDE.guides.structure.ITEM_TYPES.PAGE,
      content: content,
      layout: window.codioIDE.guides.structure.LAYOUT.L_1_PANEL,
      closeAllTabs: true,
      showFileTree: false
    }, null, 0)  // null = root parent, 0 = first position
    console.log('Page added ->', newPage)
  } catch (e) {
    console.error(e)
  }
  return newPage
}

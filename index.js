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
    coachAPI.showThinkingAnimation()
    await generateLearningObjectives()
    coachAPI.hideThinkingAnimation()
    showMenuButtons()
  }

  async function onAssistantTwoButtonPress() {
    coachAPI.showThinkingAnimation()
    await startAltTextGeneration()
    coachAPI.hideThinkingAnimation()
    showMenuButtons()
  }


  // ── ASSISTANT 1: LEARNING OBJECTIVES ───────────────────────────────────────

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

  async function generateLearningObjectives() {
    const guidePages = await fetchAssignmentPages()

    // Concatenate all page content into a single string for LLM context
    let concatenatedPages = ""
    for (const pageData of Object.values(guidePages)) {
      concatenatedPages += pageData.content
    }
    console.log(concatenatedPages)

    codioIDE.coachBot.write(`Generating Learning Objectives ... please wait...`)
    const userPrompt = learningObjectivesPrompt.replace('{{CONTENT}}', concatenatedPages)

    const generatedContent = await fetchLLMResponseXMLTagContents(learningObjSystemPrompt, userPrompt, "learning_objectives")
    console.log("Generated Learning Objective result", generatedContent)

    await addPageToGuide('Learning Objectives', generatedContent)

    codioIDE.coachBot.write(`Learning Objectives page generated successfully!`)
    codioIDE.coachBot.showMenu()
  }


  // ── ASSISTANT 2: ALT TEXT GENERATION ───────────────────────────────────────

  // Config
  // Refer to Anthropic's guide on system prompts: https://docs.anthropic.com/claude/docs/system-prompts
  const altTextGenSystemPrompt = "You are a helpful assistant with an expertise at writing alt text for images. Your response must always be in plain English, a sentence or a paragraph of 3-4 sentences, with no new lines and no bullet points."

  // AWS Lambda function URL (handles Claude API calls server-side)
  const lambdaUrl = 'https://wrib7ayaikuoognvwh4xjlqtim0zunnd.lambda-url.us-east-2.on.aws/';

  // Image parsing utilities

  // Generic or filename-like alt text is treated as missing — threshold of 100 chars filters out short placeholder values
  const GENERIC_ALT_TERMS = /^(image|img|photo|picture|pic|screenshot|screen shot|figure|fig|graphic|icon|logo|banner|thumbnail|thumb|placeholder|untitled)$/i
  const FILENAME_PATTERN = /^[\w\-]+\.\w{2,5}$/

  // Detect both markdown `![]()` and HTML `<img>` image syntax
  const markdownPattern = /!\[.*?\]\(.*?\)/g
  const htmlImgPattern = /<img\s+[^>]*?src\s*=\s*(['"])(.*?)\1[^>]*?\/?>/gi

  function getMediaType(filePath) {
    const baseName = filePath.split(/[\\/]/).pop() || '';
    const dotIndex = baseName.lastIndexOf('.');
    const ext = dotIndex >= 0 ? baseName.slice(dotIndex + 1).toLowerCase() : '';

    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      default:
        throw new Error(`Unsupported image extension: ${ext}`);
    }
  }

  function isMeaningfulAltText(altText) {
    const trimmed = altText.trim()
    if (trimmed.length === 0) return false
    if (trimmed.length < 100) return false   // short strings are likely placeholders, not real descriptions
    if (GENERIC_ALT_TERMS.test(trimmed)) return false
    if (FILENAME_PATTERN.test(trimmed)) return false
    return true
  }

  function isExternalUrl(src) {
    return /^https?:\/\/|^\/\//.test(src)
  }

  // Finds all images on a page (markdown and HTML) and returns a unified descriptor array
  function normalizeImageMatches(pageContent) {
    const results = []

    for (const m of pageContent.matchAll(markdownPattern)) {
      const altMatch = m[0].match(/(?<=\[)(.*?)(?=\])/)
      const pathMatch = m[0].match(/(?<=\()(.*?)(?=\))/)
      results.push({
        originalString: m[0],
        filepath: pathMatch ? pathMatch[0] : '',
        existingAltText: altMatch ? altMatch[0].trim() : '',
        type: 'markdown'
      })
    }

    for (const m of pageContent.matchAll(htmlImgPattern)) {
      const altAttrMatch = m[0].match(/alt\s*=\s*(['"])(.*?)\1/i)
      results.push({
        originalString: m[0],
        filepath: m[2],
        existingAltText: altAttrMatch ? altAttrMatch[2].trim() : '',
        type: 'html'
      })
    }

    return results
  }

  // Reconstructs the image string (markdown or HTML) with the new alt text inserted
  function buildReplacement(descriptor, newAltText) {
    if (descriptor.type === 'markdown') {
      return `![${newAltText}](${descriptor.filepath})`
    }

    const tag = descriptor.originalString
    if (/alt\s*=\s*(['"]).*?\1/i.test(tag)) {
      return tag.replace(/alt\s*=\s*(['"]).*?\1/i, `alt="${newAltText}"`)
    }
    return tag.replace(/<img/i, `<img alt="${newAltText}"`)
  }

  // Guide fetching

  async function fetchGuidePages() {
    const guidesStructure = await codioIDE.guides.structure.getStructure()
    console.log("This is the guides structure", guidesStructure)

    const findPagesFilter = (obj) => {
      if (!obj || typeof obj !== 'object') return [];
      return [
        ...(obj.type === 'page' ? [obj] : []),
        ...Object.values(obj).flatMap(findPagesFilter)
      ];
    };

    return findPagesFilter(guidesStructure)
  }

  // Lambda communication

  async function callLambdaWithRetry(urlWithParams, options, filepath) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const fetchRequest = await fetch(urlWithParams, options);

        if (!fetchRequest.ok) {
          const errorText = await fetchRequest.text();
          throw new Error(`HTTP ${fetchRequest.status}: ${errorText}`);
        }

        return await fetchRequest.json();
      } catch (fetchError) {
        console.error(`Attempt ${attempt}/${maxRetries} failed for ${filepath}:`, fetchError);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        } else {
          throw fetchError;
        }
      }
    }
  }

  // Image processing

  // Returns { status: 'replaced', replacement } | { status: 'skipped_external' } | { status: 'skipped_alt_exists' }
  // Throws on unrecoverable errors so Promise.allSettled can catch them.
  async function processImage(match, matchNumber, pageTitle) {
    if (isExternalUrl(match.filepath)) {
      console.log(`Image ${matchNumber} is externally hosted, skipping.`)
      codioIDE.coachBot.hideThinkingAnimation()
      codioIDE.coachBot.write(`Skipped image ${matchNumber}: externally hosted image (${match.filepath}). Only local workspace images are processed.`);
      codioIDE.coachBot.showThinkingAnimation()
      return { status: 'skipped_external' }
    }

    if (isMeaningfulAltText(match.existingAltText)) {
      console.log(`Image ${matchNumber} already has meaningful alt text, skipping.`)
      return { status: 'skipped_alt_exists' }
    }

    if (!match.filepath) {
      throw new Error('Could not extract image filepath.')
    }

    const filepath = match.filepath
    const imgFile = await window.codioIDE.files.getFileBase64(filepath)
    const mediaType = getMediaType(filepath)

    const postData = { imgData: imgFile };
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData),
    };

    const params = new URLSearchParams({
      prompt: `This image is on a page titled: ${pageTitle}. Provide only the alt text for this image. Respond with clarity and brevity.`,
      systemPrompt: altTextGenSystemPrompt,
      mediaType: mediaType
    });

    console.log("These are the params", params.toString())

    const urlWithParams = `${lambdaUrl}?${params.toString()}`;
    const data = await callLambdaWithRetry(urlWithParams, options, filepath);

    const llmResponse = data?.responseText;
    if (!llmResponse) {
      throw new Error('Lambda returned no responseText.');
    }

    return {
      status: 'replaced',
      replacement: {
        og_match_string: match.originalString,
        updated_with_alt_text: buildReplacement(match, llmResponse)
      }
    }
  }

  async function updatePageContent(pageId, pageTitle, pageContent, replacements) {
    for (const match of replacements) {
      pageContent = pageContent.replaceAll(match.og_match_string, match.updated_with_alt_text)
    }
    console.log("updated page content", pageContent)

    if (replacements.length > 0) {
      try {
        console.log("Page id for updates: ", pageId)
        const updateRes = await window.codioIDE.guides.structure.update(pageId, {
          title: pageTitle,
          content: pageContent
        })
        console.log('item updated', updateRes)
      } catch (e) {
        console.error(e)
      }
    }

    return pageContent
  }

  // Returns { imagesProcessed, imagesSkippedErrors, externallySkipped } for the final summary.
  async function processPage(page, pageNumber, totalPages) {
    const page_id = page.id
    const pageTitle = page.title
    const pageData = await codioIDE.guides.structure.get(page_id)
    const pageContent = pageData.settings.content

    codioIDE.coachBot.hideThinkingAnimation()
    codioIDE.coachBot.write(`Searching page ${pageNumber} of ${totalPages}: ${pageTitle}`);
    codioIDE.coachBot.showThinkingAnimation()

    console.log(`Searching page ${pageNumber} of ${totalPages}: ${pageTitle}`)

    const matches = normalizeImageMatches(pageContent)

    if (matches.length === 0) {
      console.log("No matches on this page")
      return { imagesProcessed: 0, imagesSkippedErrors: 0, externallySkipped: 0 }
    }

    console.log("matches object", matches)

    codioIDE.coachBot.hideThinkingAnimation()
    codioIDE.coachBot.write(`Found ${matches.length} images on this page!`);
    codioIDE.coachBot.showThinkingAnimation()

    // Use allSettled so a single failing image doesn't abort the rest of the page
    const results = await Promise.allSettled(matches.map(async (match, index) => {
      const matchNumber = index + 1
      console.log(`This is match object ${matchNumber}: ${match.originalString}`)
      console.log("Page id with matches: ", page_id)
      return processImage(match, matchNumber, pageTitle)
    }))

    const alt_text_replacements = []
    const skippedImages = []
    let alreadyHadAlt = 0
    let externallySkipped = 0

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const matchNumber = i + 1

      if (result.status === 'fulfilled') {
        const { status, replacement } = result.value
        if (status === 'replaced') {
          alt_text_replacements.push(replacement)
          codioIDE.coachBot.hideThinkingAnimation()
          codioIDE.coachBot.write(`Generated alt text for image ${matchNumber} of ${matches.length}`);
          codioIDE.coachBot.showThinkingAnimation()
        } else if (status === 'skipped_external') {
          externallySkipped++
        } else if (status === 'skipped_alt_exists') {
          alreadyHadAlt++
        }
      } else {
        console.error(`Error processing image ${matchNumber} on page ${pageNumber}:`, result.reason);
        skippedImages.push(`Image ${matchNumber} (${matches[i].originalString}): ${result.reason.message}`)
      }
    }

    console.log("Here are the alt text replacements", alt_text_replacements)

    if (skippedImages.length > 0) {
      codioIDE.coachBot.hideThinkingAnimation()
      codioIDE.coachBot.write(`Warning: ${skippedImages.length} out of ${matches.length} image(s) on page ${pageNumber} could not be processed:\n${skippedImages.join('\n')}`);
      codioIDE.coachBot.showThinkingAnimation()
    }

    await updatePageContent(page_id, pageTitle, pageContent, alt_text_replacements)

    const totalOnPage = matches.length
    const succeeded = alt_text_replacements.length
    const skipped = skippedImages.length

    codioIDE.coachBot.hideThinkingAnimation()
    if (alreadyHadAlt === totalOnPage) {
      codioIDE.coachBot.write(`All images on this page already have alt text.`);
    } else if (skipped === 0 && alreadyHadAlt === 0 && externallySkipped === 0) {
      codioIDE.coachBot.write(`Updated alt text for ${succeeded} image(s) on this page!`);
    } else if (succeeded > 0) {
      codioIDE.coachBot.write(`Updated ${succeeded} of ${totalOnPage} image(s) on this page.`);
    }
    codioIDE.coachBot.showThinkingAnimation()

    return {
      imagesProcessed: alt_text_replacements.length,
      imagesSkippedErrors: skippedImages.length,
      externallySkipped: externallySkipped
    }
  }

  // Orchestrator

  async function startAltTextGeneration() {
    codioIDE.coachBot.write(`Generating alt text for ya my bestie... give me a sec and I'll get started!`);
    codioIDE.coachBot.showThinkingAnimation()

    const pages = await fetchGuidePages()
    const totalPages = pages.length

    let totalImagesProcessed = 0
    let totalPagesWithImages = 0
    let totalImagesSkippedErrors = 0
    let totalExternallySkipped = 0

    for (const element_index in pages) {
      const pageNumber = parseInt(element_index, 10) + 1
      const { imagesProcessed, imagesSkippedErrors, externallySkipped } = await processPage(pages[element_index], pageNumber, totalPages)

      totalImagesProcessed += imagesProcessed
      totalImagesSkippedErrors += imagesSkippedErrors
      totalExternallySkipped += externallySkipped
      if (imagesProcessed > 0) {
        totalPagesWithImages++
      }
    }

    let summary = `Done! Processed ${totalImagesProcessed} image(s) across ${totalPagesWithImages} page(s).`
    if (totalImagesSkippedErrors > 0) {
      summary += ` ${totalImagesSkippedErrors} image(s) were skipped due to errors.`
    }
    if (totalExternallySkipped > 0) {
      summary += ` ${totalExternallySkipped} image(s) were skipped because they are externally hosted.`
    }

    codioIDE.coachBot.hideThinkingAnimation()
    codioIDE.coachBot.write(summary);
  }


// calling the function immediately by passing the required variables
})(window.codioIDE, window)

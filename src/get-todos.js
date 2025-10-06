class TodoParser {
  // Support all unordered list bullet symbols as per spec (https://daringfireball.net/projects/markdown/syntax#list)
  bulletSymbols = ["-", "*", "+"];

  // Default completed status markers
  doneStatusMarkers = ["x", "X", "-"];

  // List of strings that include the Markdown content
  #lines;

  // Boolean that encodes whether nested items should be rolled over
  #withChildren;

  // Parse content with segmentation to allow for Unicode grapheme clusters
  #parseIntoChars(content, contentType = "content") {
    // Use Intl.Segmenter to properly split grapheme clusters if available,
    // otherwise fall back to Array.from. The fallback should not trigger in
    // Obsidian since it uses Electron which supports Intl.Segmenter.
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
      return Array.from(segmenter.segment(content), (s) => s.segment);
    } else {
      // Array.from() splits surrogate pairs correctly but not complex grapheme clusters
      // (e.g., 👨‍👩‍👧‍👦 would be split incorrectly) and fail to match.
      console.error(
        `Intl.Segmenter not available, falling back to Array.from() for ${contentType}`
      );
      return Array.from(content);
    }
  }

  constructor(lines, withChildren, doneStatusMarkers) {
    this.#lines = lines;
    this.#withChildren = withChildren;
    if (doneStatusMarkers) {
      this.doneStatusMarkers = this.#parseIntoChars(
        doneStatusMarkers,
        "done status markers"
      );
    }
  }

  // Returns true if string s is a todo-item
  #isTodo(s) {
    // Extract the checkbox content
    const match = s.match(/\s*[*+-] \[(.+?)\]/);
    if (!match) return false;

    const checkboxContent = match[1];

    // Parse content with segmentation to allow for Unicode grapheme clusters
    const contentChars = this.#parseIntoChars(
      checkboxContent,
      "checkbox content"
    );

    // Valid checkbox content must be exactly one grapheme cluster
    if (contentChars.length !== 1) {
      return false;
    }

    const singleChar = contentChars[0];

    // Exclude grapheme modifiers that are not valid as standalone content
    const graphemeModifiers = ['\u202E', '\u200B', '\u200C', '\u200D'];
    const hasGraphemeModifier = contentChars.some((char) =>
      graphemeModifiers.includes(char)
    );
    if (hasGraphemeModifier) {
      return false;
    }

    // Check if the checkbox content contains any characters that are in doneStatusMarkers
    const hasDoneMarker = contentChars.some((char) =>
      this.doneStatusMarkers.includes(char)
    );

    // Return true (is a todo) if it does NOT contain any done markers
    return !hasDoneMarker;
  }

  // Public method to check if a line is a todo
  isTodo(s) {
    return this.#isTodo(s);
  }

  // Returns true if line after line-number `l` is a nested item
  #hasChildren(l) {
    if (l + 1 >= this.#lines.length) {
      return false;
    }
    const indCurr = this.#getIndentation(l);
    const indNext = this.#getIndentation(l + 1);
    if (indNext > indCurr) {
      return true;
    }
    return false;
  }

  // Returns a list of strings that are the nested items after line `parentLinum`
  #getChildren(parentLinum) {
    const children = [];
    let nextLinum = parentLinum + 1;
    while (this.#isChildOf(parentLinum, nextLinum)) {
      children.push(this.#lines[nextLinum]);
      nextLinum++;
    }
    return children;
  }

  // Returns true if line `linum` has more indentation than line `parentLinum`
  #isChildOf(parentLinum, linum) {
    if (parentLinum >= this.#lines.length || linum >= this.#lines.length) {
      return false;
    }
    return this.#getIndentation(linum) > this.#getIndentation(parentLinum);
  }

  // Returns the number of whitespace-characters at beginning of string at line `l`
  #getIndentation(l) {
    return this.#lines[l].search(/\S/);
  }

  // Returns a list of strings that represents all the todos along with there potential children
  getTodos() {
    let todos = [];
    for (let l = 0; l < this.#lines.length; l++) {
      const line = this.#lines[l];
      if (this.#isTodo(line)) {
        todos.push(line);
        if (this.#withChildren && this.#hasChildren(l)) {
          const cs = this.#getChildren(l);
          todos = [...todos, ...cs];
          l += cs.length;
        }
      }
    }
    return todos;
  }
}

// Utility-function that acts as a thin wrapper around `TodoParser`
export const getTodos = ({
  lines,
  withChildren = false,
  doneStatusMarkers = null,
}) => {
  const todoParser = new TodoParser(lines, withChildren, doneStatusMarkers);
  return todoParser.getTodos();
};

// Extract todos grouped by their section headers
export const getTodosWithSections = ({
  lines,
  withChildren = false,
  doneStatusMarkers = null,
}) => {
  const todoParser = new TodoParser(lines, withChildren, doneStatusMarkers);
  const sections = [];
  let currentSection = null;
  let currentSectionTodos = [];
  
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    
    // Check if this line is a heading (## or more)
    const headingMatch = line.match(/^(#{2,})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section if it has todos
      if (currentSectionTodos.length > 0) {
        sections.push({
          heading: currentSection,
          todos: currentSectionTodos,
        });
      }
      // Start new section
      currentSection = line;
      currentSectionTodos = [];
      continue;
    }
    
    // Check if this line is a todo
    if (todoParser.isTodo(line)) {
      const todoLines = [line];
      
      // If we need to include children, get them manually
      if (withChildren) {
        let childIdx = l + 1;
        const parentIndent = line.search(/\S/);
        
        while (childIdx < lines.length) {
          const childLine = lines[childIdx];
          const childIndent = childLine.search(/\S/);
          
          // If the next line has more indentation, it's a child
          if (childIndent > parentIndent && childIndent >= 0) {
            todoLines.push(childLine);
            childIdx++;
          } else {
            break;
          }
        }
        
        // Skip the children we just processed
        l = childIdx - 1;
      }
      
      currentSectionTodos.push(...todoLines);
    }
  }
  
  // Don't forget the last section
  if (currentSectionTodos.length > 0) {
    sections.push({
      heading: currentSection,
      todos: currentSectionTodos,
    });
  }
  
  return sections;
};

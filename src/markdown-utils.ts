/**
 * Markdown Utilities
 *
 * Shared functions for converting JSON structures to human-readable markdown.
 */

/**
 * Escape markdown special characters in text
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}

/**
 * Create a markdown table from an array of objects
 */
export function createTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_No items_\n';

  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `|${headers.map(() => '---').join('|')}|`;
  const dataRows = rows.map(row => `| ${row.join(' | ')} |`).join('\n');

  return `${headerRow}\n${separatorRow}\n${dataRows}\n`;
}

/**
 * Create a collapsible details section
 */
export function createDetails(summary: string, content: string): string {
  return `<details>
<summary>${summary}</summary>

${content}

</details>
`;
}

/**
 * Format a date string for display
 */
export function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Create a badge for priority levels
 */
export function priorityBadge(priority: string): string {
  const badges: Record<string, string> = {
    critical: '🔴 Critical',
    high: '🟠 High',
    medium: '🟡 Medium',
    low: '🟢 Low',
    must_have: '🔴 Must Have',
    should_have: '🟠 Should Have',
    nice_to_have: '🟢 Nice to Have',
  };
  return badges[priority.toLowerCase()] || priority;
}

/**
 * Wrap long text for better table display
 */
export function truncate(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Convert a section of markdown/text to a formatted block
 */
export function formatSection(title: string, content: string | undefined, level: number = 2): string {
  if (!content || content.trim() === '' || content === 'See council synthesis') {
    return '';
  }

  const heading = '#'.repeat(level);
  return `${heading} ${title}\n\n${content}\n\n`;
}

/**
 * Format a list of items as a markdown bullet list
 */
export function formatBulletList(items: string[]): string {
  if (!items || items.length === 0) return '_None_\n';
  return items.map(item => `- ${item}`).join('\n') + '\n';
}

/**
 * Format a numbered list
 */
export function formatNumberedList(items: string[]): string {
  if (!items || items.length === 0) return '_None_\n';
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n') + '\n';
}

/**
 * Create a code block
 */
export function codeBlock(code: string, language: string = ''): string {
  return `\`\`\`${language}\n${code}\n\`\`\`\n`;
}

/**
 * Create a horizontal rule
 */
export function hr(): string {
  return '\n---\n\n';
}

/**
 * Create a table of contents from headings
 */
export function createTOC(headings: Array<{ level: number; text: string }>): string {
  return headings
    .map(h => {
      const indent = '  '.repeat(h.level - 2);
      const anchor = h.text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return `${indent}- [${h.text}](#${anchor})`;
    })
    .join('\n') + '\n';
}

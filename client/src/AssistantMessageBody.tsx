import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import type { Components } from 'react-markdown'

const markdownComponents: Components = {
  pre({ children }) {
    return <pre className="app-md-pre">{children}</pre>
  },
  code({ className, children }) {
    const isInline = !className
    if (isInline) {
      return <code className="app-md-code-inline">{children}</code>
    }
    return <code className={className}>{children}</code>
  },
}

type Props = {
  text: string
}

/** Renders assistant replies: fenced code blocks + light Markdown, sanitized. */
export function AssistantMessageBody({ text }: Props) {
  return (
    <div className="app-md">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

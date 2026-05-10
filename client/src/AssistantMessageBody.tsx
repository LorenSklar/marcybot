import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
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

/** Renders assistant replies: Markdown plus inline HTML (models often emit `<p>`, lists, etc.). Raw HTML is parsed then sanitized. */
export function AssistantMessageBody({ text }: Props) {
  return (
    <div className="app-md">
      <ReactMarkdown
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

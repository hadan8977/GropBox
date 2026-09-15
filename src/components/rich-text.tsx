import { Fragment, type ReactNode } from "react";
import { isRichDocument, safeHref, type RichNode } from "@/lib/model";

function render(node: RichNode, key: number): ReactNode {
  let children: ReactNode = node.text ?? node.content?.map(render);
  if (node.type === "text") {
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") children = <strong>{children}</strong>;
      if (mark.type === "italic") children = <em>{children}</em>;
      if (mark.type === "strike") children = <s>{children}</s>;
      if (mark.type === "underline") children = <u>{children}</u>;
      if (mark.type === "code") children = <code>{children}</code>;
      if (mark.type === "link" && safeHref(mark.attrs?.href)) children = <a href={safeHref(mark.attrs?.href)} target="_blank" rel="noopener noreferrer">{children}</a>;
    }
    return <Fragment key={key}>{children}</Fragment>;
  }
  switch (node.type) {
    case "doc": return <Fragment key={key}>{children}</Fragment>;
    case "paragraph": return <p key={key}>{children || <br />}</p>;
    case "heading": return <h3 key={key}>{children}</h3>;
    case "bulletList": return <ul key={key}>{children}</ul>;
    case "orderedList": return <ol key={key}>{children}</ol>;
    case "listItem": return <li key={key}>{children}</li>;
    case "blockquote": return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock": return <pre key={key}><code>{children}</code></pre>;
    case "hardBreak": return <br key={key} />;
    case "horizontalRule": return <hr key={key} />;
    case "table": return <div className="table-scroll" key={key}><table><tbody>{children}</tbody></table></div>;
    case "tableRow": return <tr key={key}>{children}</tr>;
    case "tableHeader": return <th key={key}>{children}</th>;
    case "tableCell": return <td key={key}>{children}</td>;
    default: return null;
  }
}
export function RichText({ body }: { body: RichNode | string }) {
  if (typeof body === "string") return <div className="plain-text">{body}</div>;
  return <div className="rich-text">{isRichDocument(body) ? render(body, 0) : "Preview unavailable."}</div>;
}

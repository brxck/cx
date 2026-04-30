import { Action, ActionPanel, Form, Toast, popToRoot, showToast } from "@raycast/api";
import { useFetch } from "@raycast/utils";
import { useState } from "react";
import { CxServeUnreachable, apiUrl, upWorkspace, type TemplatesResponse } from "./api";

export default function Command() {
  const { isLoading, data, error } = useFetch<TemplatesResponse>(apiUrl("/api/templates"));
  const [submitting, setSubmitting] = useState(false);

  if (error) {
    return (
      <Form>
        <Form.Description text={`Cannot reach cx serve: ${error.message}\nRun \`cx serve\` and try again.`} />
      </Form>
    );
  }

  const templates = data?.templates ?? [];

  return (
    <Form
      isLoading={isLoading || submitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Bring Up Layout"
            onSubmit={async (values: { template: string; workspace: string; vars: string }) => {
              if (!values.template || !values.workspace) {
                await showToast({ style: Toast.Style.Failure, title: "template and workspace are required" });
                return;
              }
              let parsedVars: Record<string, string> | undefined;
              if (values.vars?.trim()) {
                try {
                  const parsed = JSON.parse(values.vars);
                  if (parsed && typeof parsed === "object") {
                    parsedVars = parsed as Record<string, string>;
                  } else {
                    throw new Error("Vars must be a JSON object");
                  }
                } catch (err) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: "Invalid vars JSON",
                    message: err instanceof Error ? err.message : String(err),
                  });
                  return;
                }
              }

              setSubmitting(true);
              const toast = await showToast({
                style: Toast.Style.Animated,
                title: `Bringing up ${values.workspace}…`,
              });
              try {
                const result = await upWorkspace({
                  template: values.template,
                  workspace: values.workspace,
                  vars: parsedVars,
                });
                if (result.ok) {
                  toast.style = Toast.Style.Success;
                  toast.title = `${values.workspace} ready`;
                  await popToRoot();
                } else {
                  toast.style = Toast.Style.Failure;
                  toast.title = "Up failed";
                  toast.message = result.error;
                }
              } catch (err) {
                toast.style = Toast.Style.Failure;
                toast.title = err instanceof CxServeUnreachable ? "cx serve unreachable" : "Up failed";
                toast.message = err instanceof Error ? err.message : String(err);
              } finally {
                setSubmitting(false);
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="template" title="Template" storeValue>
        {templates.map((tpl) => (
          <Form.Dropdown.Item
            key={`${tpl.source}:${tpl.name}`}
            value={tpl.name}
            title={tpl.name}
            keywords={[tpl.coderTemplate ?? "", tpl.type ?? "", tpl.source].filter(Boolean)}
          />
        ))}
      </Form.Dropdown>
      <Form.TextField
        id="workspace"
        title="Workspace name"
        placeholder="my-workspace"
        info="Coder workspace name (also used as the layout name)."
      />
      <Form.TextArea
        id="vars"
        title="Variables (optional)"
        placeholder={'{"key": "value"}'}
        info="JSON object passed to the template's variables."
      />
    </Form>
  );
}

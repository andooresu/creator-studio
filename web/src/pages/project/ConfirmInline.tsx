// Confirmación en línea: «¿Seguro? Sí / No» sin diálogos del navegador.
import { Button } from "@/components/ui/button.tsx";

export function ConfirmInline({ question, yes, onYes, onNo }: { question: string; yes: string; onYes: () => void; onNo: () => void }) {
  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-[13px]">
      <span className="mr-1">{question}</span>
      <Button size="sm" variant="secondary" onClick={onYes}>{yes}</Button>
      <Button size="sm" variant="ghost" autoFocus onClick={onNo}>No</Button>
    </div>
  );
}

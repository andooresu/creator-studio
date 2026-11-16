// Pregunta antes de salir de una pantalla con cambios sin guardar (ver useLeaveGuard en store.tsx).
import { useApp } from "@/store.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.tsx";

export function LeaveDialog() {
  const { pendingLeave, confirmLeave, cancelLeave } = useApp();
  return (
    <Dialog open={!!pendingLeave} onOpenChange={(o) => { if (!o) cancelLeave(); }}>
      <DialogContent className="rounded-xl border-0 bg-surface-1 shadow-lift sm:max-w-md" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogTitle className="m-0 text-[17px] font-semibold tracking-[-0.02em]">¿Salir sin guardar?</DialogTitle>
        <DialogDescription className="m-0 text-sm text-muted-foreground">{pendingLeave?.message}</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={cancelLeave} autoFocus>Seguir editando</Button>
          <Button variant="destructive" onClick={confirmLeave}>Salir sin guardar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

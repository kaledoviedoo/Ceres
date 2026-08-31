/**
 * Estructura de la pantalla: barra superior, columna izquierda de control,
 * lienzo central y panel derecho de inspección.
 *
 * Desktop-first: CERES se piensa para un agrónomo con una pantalla grande. En
 * anchos pequeños las tres columnas se apilan para que siga siendo usable, sin
 * pretender ser una app móvil.
 */

interface DashboardShellProps {
  statusBar: React.ReactNode;
  sidebar: React.ReactNode;
  canvas: React.ReactNode;
  inspector: React.ReactNode;
}

export function DashboardShell({ statusBar, sidebar, canvas, inspector }: DashboardShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      {statusBar}
      <main className="grid flex-1 gap-4 p-4 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
        <aside className="space-y-4">{sidebar}</aside>
        <section className="min-w-0">{canvas}</section>
        <aside className="min-w-0">{inspector}</aside>
      </main>
    </div>
  );
}

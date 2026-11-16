#!/bin/zsh
# Compatibilidad: este archivo se llamaba así antes de que la app pasara a llamarse Andoo.
# El «Actualizar.command» de versiones anteriores lo abre al terminar; reenvía al nuevo.
cd "$(dirname "$0")"
exec "./Abrir Andoo.command"

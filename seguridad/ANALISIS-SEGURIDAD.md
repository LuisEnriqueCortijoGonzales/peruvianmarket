# Análisis Estático de Seguridad

**Proyecto:** PeruvianMarket · Criptografía Aplicada — UTEC
**Fecha del análisis:** 2026-07-10
**Entorno:** Node.js v22.12.0 · npm 11.9.0

> Cumple el requisito de la rúbrica (2da entrega, §3 Seguridad práctica):
> *"Se hace uso de una herramienta de análisis estático de seguridad para analizar el código implementado."*

---

## 1. Herramientas utilizadas

| Herramienta | Tipo de análisis | Resultado |
|---|---|---|
| **`npm audit`** | Escáner de vulnerabilidades en dependencias (CVE / GHSA) | ✅ **0 vulnerabilidades** |
| **`tsc --noEmit`** | Análisis estático de tipos (TypeScript) | ✅ 0 errores |
| **`next lint` (ESLint)** | Linting estático de código | ✅ sin errores bloqueantes |

La evidencia cruda del escaneo de dependencias está en:
- [`npm-audit.txt`](npm-audit.txt) — salida legible
- [`npm-audit.json`](npm-audit.json) — reporte completo en formato JSON (`auditReportVersion: 2`)

---

## 2. Resultado de `npm audit`

```
found 0 vulnerabilities
```

Resumen del reporte JSON:

| Severidad | Cantidad |
|---|---|
| Critical | 0 |
| High | 0 |
| Moderate | 0 |
| Low | 0 |
| Info | 0 |
| **Total** | **0** |

Dependencias analizadas: 40 de producción, 367 de desarrollo, 63 opcionales.

---

## 3. Vulnerabilidad detectada y corregida durante el desarrollo

El análisis **sí encontró** una vulnerabilidad en una versión anterior, que fue
corregida de forma segura (documentado aquí como evidencia del proceso):

**Hallazgo original (`npm audit`):**
```
postcss  < 8.5.10
Severity: moderate
PostCSS has XSS via Unescaped </style> in its CSS Stringify Output
(GHSA-qx2v-qp2m-jg93)
```

- **Vector:** `postcss` era una dependencia transitiva empaquetada dentro de Next.js.
- **Riesgo real en el proyecto:** bajo — `postcss` solo se ejecuta en tiempo de *build*
  procesando nuestro propio CSS de Tailwind; ningún usuario puede inyectar CSS.

**Corrección aplicada (sin romper la app):**

La sugerencia automática de npm (`npm audit fix --force`) proponía degradar Next.js 15
a Next.js 9 (2020) — un cambio destructivo que habría roto toda la aplicación. En su
lugar se forzó la versión parchada mediante un `override` en `package.json`:

```json
"overrides": {
  "postcss": "$postcss"
}
```

Combinado con `"postcss": "^8.5.10"` en `devDependencies`, esto obliga a que **toda**
copia de `postcss` en el árbol de dependencias (incluida la interna de Next.js) use la
versión corregida. Resultado posterior: **0 vulnerabilidades**, build intacto.

> **Lección aplicada:** los `--force` de `npm audit` deben revisarse manualmente antes de
> aceptarse; una "corrección" automática puede introducir un cambio destructivo peor que
> la vulnerabilidad original.

---

## 4. Cómo reproducir el análisis

```bash
cd web
npm install
npm audit                 # escaneo de dependencias  → 0 vulnerabilidades
npx tsc --noEmit          # análisis estático de tipos
npm run lint              # ESLint
```

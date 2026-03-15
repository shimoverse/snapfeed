'use client'

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
} from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type AnnotationTool = 'pen' | 'rect' | 'arrow' | 'highlighter'

interface Point {
  x: number
  y: number
}

interface Stroke {
  tool: AnnotationTool
  color: string
  points: Point[]
  /** For rect: start point */
  start?: Point
  /** For rect/arrow: end point */
  end?: Point
  lineWidth: number
}

// ─── Tool config ──────────────────────────────────────────────────────────────

const TOOLS: Array<{ id: AnnotationTool; label: string; title: string }> = [
  { id: 'pen', label: '✏️', title: 'Free draw' },
  { id: 'rect', label: '⬜', title: 'Rectangle' },
  { id: 'arrow', label: '↗', title: 'Arrow' },
  { id: 'highlighter', label: '🖊', title: 'Highlighter' },
]

const COLORS: Array<{ value: string; label: string }> = [
  { value: '#EF4444', label: 'Red' },
  { value: '#FBBF24', label: 'Yellow' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#FFFFFF', label: 'White' },
  { value: '#111111', label: 'Black' },
]

function getLineWidth(tool: AnnotationTool): number {
  if (tool === 'highlighter') return 16
  if (tool === 'rect') return 3
  if (tool === 'arrow') return 3
  return 2.5
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.save()

  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.35
    ctx.globalCompositeOperation = 'source-over'
  } else {
    ctx.globalAlpha = 1
  }

  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (stroke.tool) {
    case 'pen':
    case 'highlighter': {
      if (stroke.points.length < 2) break
      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      }
      ctx.stroke()
      break
    }

    case 'rect': {
      if (!stroke.start || !stroke.end) break
      const x = Math.min(stroke.start.x, stroke.end.x)
      const y = Math.min(stroke.start.y, stroke.end.y)
      const w = Math.abs(stroke.end.x - stroke.start.x)
      const h = Math.abs(stroke.end.y - stroke.start.y)
      ctx.beginPath()
      ctx.strokeRect(x, y, w, h)
      break
    }

    case 'arrow': {
      if (!stroke.start || !stroke.end) break
      const { start, end } = stroke
      const dx = end.x - start.x
      const dy = end.y - start.y
      const angle = Math.atan2(dy, dx)
      const headLen = Math.max(12, stroke.lineWidth * 5)

      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()

      // Arrow head
      ctx.beginPath()
      ctx.moveTo(end.x, end.y)
      ctx.lineTo(
        end.x - headLen * Math.cos(angle - Math.PI / 7),
        end.y - headLen * Math.sin(angle - Math.PI / 7)
      )
      ctx.moveTo(end.x, end.y)
      ctx.lineTo(
        end.x - headLen * Math.cos(angle + Math.PI / 7),
        end.y - headLen * Math.sin(angle + Math.PI / 7)
      )
      ctx.stroke()
      break
    }
  }

  ctx.restore()
}

function redrawAll(ctx: CanvasRenderingContext2D, strokes: Stroke[]): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  for (const stroke of strokes) {
    drawStroke(ctx, stroke)
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface AnnotationCanvasProps {
  /** The image data URL (e.g. "data:image/png;base64,...") */
  imageDataUrl: string
  /** Called with the merged annotated image data URL when done */
  onDone: (annotatedDataUrl: string) => void
  /** Called when the user cancels annotation */
  onCancel: () => void
  /** Accent color for UI highlights */
  accentColor?: string
  /** Theme for toolbar */
  theme?: 'light' | 'dark'
}

export function AnnotationCanvas({
  imageDataUrl,
  onDone,
  onCancel,
  accentColor = '#D4714B',
  theme = 'light',
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null)
  const [activeTool, setActiveTool] = useState<AnnotationTool>('pen')
  const [activeColor, setActiveColor] = useState('#EF4444')
  const [drawing, setDrawing] = useState(false)
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 })

  const isDark = theme === 'dark'
  const toolbarBg = isDark ? '#2C2C2E' : '#F5F3EF'
  const toolbarBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const toolbarText = isDark ? '#F2F2F7' : '#1A1A1A'
  const toolHover = isDark ? '#3A3A3C' : '#EDE9E3'

  // Load image and set canvas size
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      setImgSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = imageDataUrl
  }, [imageDataUrl])

  // Redraw whenever strokes or currentStroke changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    redrawAll(ctx, strokes)
    if (currentStroke) {
      drawStroke(ctx, currentStroke)
    }
  }, [strokes, currentStroke])

  // Pointer position relative to canvas
  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    let clientX: number
    let clientY: number

    if ('touches' in e) {
      const touch = e.touches[0] ?? e.changedTouches[0]
      clientX = touch.clientX
      clientY = touch.clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }, [])

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const pos = getPos(e)
    const newStroke: Stroke = {
      tool: activeTool,
      color: activeColor,
      points: [pos],
      start: pos,
      end: pos,
      lineWidth: getLineWidth(activeTool),
    }
    setCurrentStroke(newStroke)
    setDrawing(true)
  }

  function continueDraw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing || !currentStroke) return
    e.preventDefault()
    const pos = getPos(e)

    const updated: Stroke = {
      ...currentStroke,
      points: [...currentStroke.points, pos],
      end: pos,
    }
    setCurrentStroke(updated)
  }

  function endDraw(e: React.MouseEvent | React.TouchEvent) {
    if (!drawing || !currentStroke) return
    e.preventDefault()
    const pos = getPos(e)
    const finalStroke: Stroke = {
      ...currentStroke,
      points: [...currentStroke.points, pos],
      end: pos,
    }
    setStrokes(prev => [...prev, finalStroke])
    setCurrentStroke(null)
    setDrawing(false)
  }

  function handleUndo() {
    setStrokes(prev => prev.slice(0, -1))
  }

  function handleDone() {
    // Merge: draw background image + annotation canvas into one canvas
    const annotCanvas = canvasRef.current
    if (!annotCanvas) return

    const mergeCanvas = document.createElement('canvas')
    mergeCanvas.width = imgSize.width
    mergeCanvas.height = imgSize.height
    const ctx = mergeCanvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, imgSize.width, imgSize.height)
      ctx.drawImage(annotCanvas, 0, 0, imgSize.width, imgSize.height)
      const merged = mergeCanvas.toDataURL('image/png')
      onDone(merged)
    }
    img.src = imageDataUrl
  }

  if (imgSize.width === 0) return null

  // Compute display size: cap at 90vw / 80vh while preserving aspect ratio
  const maxW = typeof window !== 'undefined' ? window.innerWidth * 0.9 : 800
  const maxH = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 600
  const scale = Math.min(1, maxW / imgSize.width, maxH / imgSize.height)
  const displayW = Math.round(imgSize.width * scale)
  const displayH = Math.round(imgSize.height * scale)

  const cursorMap: Record<AnnotationTool, string> = {
    pen: 'crosshair',
    highlighter: 'crosshair',
    rect: 'crosshair',
    arrow: 'crosshair',
  }

  return (
    /* Full-screen overlay */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '16px',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          background: toolbarBg,
          border: `1px solid ${toolbarBorder}`,
          borderRadius: '12px',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          maxWidth: `${displayW}px`,
          width: '100%',
          boxSizing: 'border-box',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}
      >
        {/* Tool selector */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {TOOLS.map(t => (
            <button
              key={t.id}
              title={t.title}
              onClick={() => setActiveTool(t.id)}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                border: activeTool === t.id ? `2px solid ${accentColor}` : '2px solid transparent',
                background: activeTool === t.id ? `${accentColor}22` : 'transparent',
                cursor: 'pointer',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.12s, border-color 0.12s',
              }}
              onMouseEnter={e => {
                if (activeTool !== t.id) {
                  ;(e.currentTarget as HTMLButtonElement).style.background = toolHover
                }
              }}
              onMouseLeave={e => {
                if (activeTool !== t.id) {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div
          style={{
            width: '1px',
            height: '24px',
            background: toolbarBorder,
            flexShrink: 0,
          }}
        />

        {/* Color picker */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {COLORS.map(c => (
            <button
              key={c.value}
              title={c.label}
              onClick={() => setActiveColor(c.value)}
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                border: activeColor === c.value
                  ? `3px solid ${accentColor}`
                  : '2px solid rgba(0,0,0,0.25)',
                background: c.value,
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
                transition: 'border-color 0.12s',
                boxShadow: c.value === '#FFFFFF' ? '0 0 0 1px rgba(0,0,0,0.2)' : 'none',
              }}
            />
          ))}
        </div>

        {/* Divider */}
        <div
          style={{
            width: '1px',
            height: '24px',
            background: toolbarBorder,
            flexShrink: 0,
          }}
        />

        {/* Undo */}
        <button
          onClick={handleUndo}
          disabled={strokes.length === 0}
          title="Undo last stroke"
          style={{
            padding: '5px 12px',
            borderRadius: '8px',
            border: `1px solid ${toolbarBorder}`,
            background: 'transparent',
            cursor: strokes.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            color: strokes.length === 0 ? (isDark ? '#636366' : '#9B9590') : toolbarText,
            fontFamily: 'inherit',
            transition: 'background 0.12s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            if (strokes.length > 0) {
              ;(e.currentTarget as HTMLButtonElement).style.background = toolHover
            }
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          }}
        >
          ↩ Undo
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Cancel */}
        <button
          onClick={onCancel}
          style={{
            padding: '5px 12px',
            borderRadius: '8px',
            border: `1px solid ${toolbarBorder}`,
            background: 'transparent',
            cursor: 'pointer',
            fontSize: '12px',
            color: toolbarText,
            fontFamily: 'inherit',
            transition: 'background 0.12s',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLButtonElement).style.background = toolHover
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          }}
        >
          Cancel
        </button>

        {/* Done */}
        <button
          onClick={handleDone}
          style={{
            padding: '5px 14px',
            borderRadius: '8px',
            border: 'none',
            background: accentColor,
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            color: 'white',
            fontFamily: 'inherit',
            transition: 'opacity 0.12s',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLButtonElement).style.opacity = '0.88'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLButtonElement).style.opacity = '1'
          }}
        >
          ✓ Done
        </button>
      </div>

      {/* Image + canvas container */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: `${displayW}px`,
          height: `${displayH}px`,
          flexShrink: 0,
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Background image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageDataUrl}
          alt="Screenshot to annotate"
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'fill',
            display: 'block',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />

        {/* Annotation canvas */}
        <canvas
          ref={canvasRef}
          width={imgSize.width}
          height={imgSize.height}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            cursor: cursorMap[activeTool],
            touchAction: 'none',
          }}
          onMouseDown={startDraw}
          onMouseMove={continueDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={continueDraw}
          onTouchEnd={endDraw}
        />
      </div>

      {/* Hint */}
      <div
        style={{
          fontSize: '11px',
          color: 'rgba(255,255,255,0.45)',
          textAlign: 'center',
        }}
      >
        Draw on the screenshot, then click ✓ Done to attach the annotated image.
      </div>
    </div>
  )
}

import CoreGraphics
import ImageIO
import Foundation
// Renders the iOS app icon and splash from the public/favicon.svg "FP" mark:
// the same strokes in its 128-unit space, full bleed on the brand background,
// with no alpha channel (App Store icons must be opaque).
//
//   A=ios/App/App/Assets.xcassets
//   swift scripts/render-ios-brand.swift $A/AppIcon.appiconset/AppIcon-512@2x.png 1024 6 0
//   swift scripts/render-ios-brand.swift $A/Splash.imageset/splash-2732x2732.png 2732 3.2 0
//   (then copy the splash over splash-2732x2732-1.png and -2.png)
//
// args: out.png size markScale offsetX
let a = CommandLine.arguments
let size = CGFloat(Int(a[2])!), unit = CGFloat(Double(a[3])!), dx = CGFloat(Double(a[4])!)
let n = Int(size)
let cg = CGContext(data: nil, width: n, height: n, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
cg.setFillColor(CGColor(srgbRed: 0x12/255, green: 0x21/255, blue: 0x1a/255, alpha: 1))
cg.fill(CGRect(x: 0, y: 0, width: size, height: size))
// Centre the 128-unit mark: flip y, scale, then shift.
let origin = (size - 128 * unit) / 2
cg.translateBy(x: origin + dx * unit, y: size - origin)
cg.scaleBy(x: unit, y: -unit)
cg.setStrokeColor(CGColor(srgbRed: 0xc8/255, green: 0xf1/255, blue: 0x35/255, alpha: 1))
cg.setLineWidth(14); cg.setLineCap(.butt)
let p = CGMutablePath()
p.move(to: CGPoint(x: 21, y: 30)); p.addLine(to: CGPoint(x: 21, y: 98))
p.move(to: CGPoint(x: 21, y: 37)); p.addLine(to: CGPoint(x: 58, y: 37))
p.move(to: CGPoint(x: 21, y: 64)); p.addLine(to: CGPoint(x: 52, y: 64))
p.move(to: CGPoint(x: 72, y: 30)); p.addLine(to: CGPoint(x: 72, y: 98))
p.move(to: CGPoint(x: 72, y: 37)); p.addLine(to: CGPoint(x: 93, y: 37))
p.addArc(center: CGPoint(x: 93, y: 50.5), radius: 13.5, startAngle: -.pi/2, endAngle: .pi/2, clockwise: false)
p.addLine(to: CGPoint(x: 72, y: 64))
cg.addPath(p); cg.strokePath()
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, "public.png" as CFString, 1, nil)!
CGImageDestinationAddImage(dest, cg.makeImage()!, nil)
precondition(CGImageDestinationFinalize(dest))

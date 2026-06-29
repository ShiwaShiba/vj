import AVFoundation
import AppKit
let path = CommandLine.arguments[1]
let outdir = CommandLine.arguments[2]
let asset = AVURLAsset(url: URL(fileURLWithPath: path))
let dur = CMTimeGetSeconds(asset.duration)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero; gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: 256, height: 256)   // small fixtures
let N = 40
for i in 0..<N {
  let t = dur * Double(i) / Double(N - 1)
  let ct = CMTime(seconds: max(0, min(dur - 0.01, t)), preferredTimescale: 600)
  if let cg = try? gen.copyCGImage(at: ct, actualTime: nil) {
    let rep = NSBitmapImageRep(cgImage: cg)
    let png = rep.representation(using: .png, properties: [:])!
    try! png.write(to: URL(fileURLWithPath: String(format: "%@/f%02d.png", outdir, i)))
  }
}
print("wrote \(N) frames")

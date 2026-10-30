# Fiducial Tag Arena

Browser-based stress test for fiducial marker detectors. All frames are synthesized at runtime (perspective, lens bulge, occlusion, uneven lighting, motion blur, exposure, low resolution/mosaic, sensor noise); every tag gets identical conditions and is timed one at a time.

Open the GitHub Pages site, tick the tags to compare (detectors download only when ticked), tune the conditions, and press **Run once** or **Run ticks**.

## Included detectors
| Tag | Implementation | Licence |
|---|---|---|
| AprilTag 36h11 | Official C library compiled to WASM (conix-center/apriltag-js-standalone) | BSD-3-Clause |
| ArUco 4x4 / 5x5 / 6x6 / MIP 36h12 | js-aruco2 (JS port of ArUco) | MIT |

Third-party code and licences live in `vendor/`. See the page footer for tags that were left out and why.

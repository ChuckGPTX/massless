const projects = {
  vessels: {
    title: "Soft forms",
    type: "02 / OBJECTS & MATERIAL STUDIES",
    image: "ceramics.jpg",
    alt: "Three ceramic vessels in warm window light",
    description:
      "A family of vessels built around contrast: rounded and straight, glazed and matte, sage and terracotta. A single warm light brings the collection together.",
    prompt:
      "Three sculptural handmade ceramic vessels in sage green, rust and cream on a pale travertine plinth, warm soft window light, premium still life product photography, natural tactile materials, minimalist editorial, no text or logos.",
  },
  room: {
    title: "Golden hour",
    type: "03 / INTERIORS & SLOW LIVING",
    image: "lounge.jpg",
    alt: "A sculptural chair and woven lamps in a sunlit room",
    description:
      "Curved lines soften an everyday corner. A small palette of ochre, cream and terracotta creates a room that feels warm before anyone walks in.",
    prompt:
      "Sculptural terracotta lounge chair made of curved tubular forms beside an oversized cream paper floor lamp, sunlit minimal room, olive-green plaster wall, ochre rug, art-directed interior editorial photograph, design magazine, natural materials, warm shadows, no people, no text or logos.",
  },
};
const dialog = document.querySelector("#project-dialog");
let opener;
for (const button of document.querySelectorAll("[data-project]"))
  button.addEventListener("click", () => {
    const project = projects[button.dataset.project];
    opener = button;
    document.querySelector("#project-title").textContent = project.title;
    document.querySelector("#project-type").textContent = project.type;
    document.querySelector("#project-description").textContent =
      project.description;
    const image = document.querySelector("#project-photo");
    image.src = `/media/website/${project.image}`;
    image.alt = project.alt;
    document.querySelector("#project-remix").href =
      `/image?panel=prompt&prompt=${encodeURIComponent(project.prompt)}`;
    dialog.showModal();
  });
dialog.querySelector(".close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  }
});
dialog.addEventListener("close", () => opener?.focus());

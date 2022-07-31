//DarthVader is a privacy tool intended to confuse trackers by creating noise in the collected data
//Written by Fady Anwar

var overevent = new MouseEvent("mouseover", {
                                                        "view": window,
                                                        "bubbles": true,
                                                        "cancelable": true
                                        });

var outevent = new MouseEvent("mouseout", {
                                                        "view": window,
                                                        "bubbles": true,
                                                        "cancelable": true
                                        });

function fakeHovers(){
	let elements = document.getElementsByTagName("div");
	let counter = 0;
	//iteraring elements bottm up to hit more recent ones first, i.e. for virtual doms of bottomless timelines
	for(var i = elements.length-1; i >  0; i--){
		if(Math.random() > 0.95){
			elements[i].dispatchEvent(overevent);
			elements[i].dispatchEvent(outevent);
			counter += 2;

			//capping hovers
			if(counter >= 500)
				break;
		}
	}
	console.log(counter + " fake mouse events dispatched!");
	//backoff mechanism: more elements = longer timeout
	let timeout = 5000 + elements.length;
	console.log("Next round in " +  timeout + " milliseconds");
	setTimeout(fakeHovers, timeout);
}


console.log("Faking mouse movements started!");
fakeHovers();

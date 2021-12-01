const clearButton = document.getElementById("clearButton");
const scannedCodes = document.getElementById("scannedCodes");
const scannerConfig = document.getElementById("scannerConfig");
const log = document.getElementById("log");
const adapterSelection = document.getElementById("adapterSelection");
const inLine = document.getElementById("inline");
const exsys = document.getElementById("exsys");
const connectSerialButton = document.getElementById("connectSerialButton");

// these data needs to be adapted to the specific UBS serial adapter used.
// NOTE: only the first two porperties are needed for WebSerial. The others are only needed for WebUSB
const inLineUsbSerialAdapter = {
    vendorId: 0x067B, // Prolific Technology Inc.
    productId: 0x2303 // USB-Serial Controller D
}

const exsysUsbSerialAdapter = {
    vendorId: 0x0403, // FTDI
    productId: 0x6001, // FT232R USB UART	
}

// ====================================
// Connect to the scale using WebSerial
// ====================================

// for connection managment and cleanup
let serialPortReader;
let keepReadingScale = { value: true };
let serialPortReaderClosedPromise;

// connect and keep a loop running to get data from the scale until conenction is canceled
connectScaleButton.onclick = async () => {
    let serialPort;

    // support two different USB Serial adapters
    // to address them directly, we have to know the USB Vendor ID and USB Product ID
    let usbSerialAdapter;
    if (inLine.checked == true) {
        console.log("Using the nice blue InLine USB serial adapter");
        usbSerialAdapter = inLineUsbSerialAdapter;
    }
    else {
        console.log("Using the professionally looking black Exsys serial adapter");
        usbSerialAdapter = exsysUsbSerialAdapter;
    }
    // filter for the USB Serial Adapter
    console.log("Selected USB device to connect to:", usbSerialAdapter);
    const filters = [{
        usbVendorId: usbSerialAdapter.vendorId,
        usbProductId: usbSerialAdapter.productId
    }];


    // Prompt user to select a device.
    serialPort = await navigator.serial.requestPort({ filters });

    // update UI
    connectScaleButton.style.display = "none";
    adapterSelection.style.display = "none";
    disconnectScaleButton.style.display = "initial";

    // Wait for the serial port to open.
    // here the configuration needs to be done: baudRate, parity, databits, etc...
    await serialPort.open({ baudRate: 9600 });
    console.log("Port: ", serialPort);

    // start the read loop
    serialPortReader = serialPort.readable.getReader();
    keepReadingScale.value = true;
    serialPortReaderClosedPromise = readUntilClosed(serialPort, serialPortReader, keepReadingScale);
}

// used for WebSerial
// implementation as suggested in https://web.dev/serial/
// resource management and closing of port could be more beautiful
async function readUntilClosed(port, reader, keepReading) {
    var readWeight = "";
    var readCharacter;
    // Listen to data coming from the serial device.
    while (port.readable && keepReading.value) {
        if (port.readable.locked != true) {
            reader = port.readable.getReader();
        }
        try {
            while (true) {
                var result;
                do {
                    result = await reader.read();
                    if (result.done) {
                        break;
                    }
                    const decoder = new TextDecoder(); // instead of this transform streams could be used
                    readCharacter = decoder.decode(result.value);
                    readWeight += readCharacter;
                } while (readCharacter.charCodeAt(0) !== 10);
                if(result.done) {
                    break;
                }
                readWeight = readWeight.trim();
                console.log("Weight: ", readWeight);
                scannedCodes.value += readWeight + "\n";
                readWeight = "";
            }
        }
        catch (error) {
            console.log("This is a non critical error. We can start to read again if wanted.", error);
        }
        finally {
            // Allow the serial port to be closed later.
            reader.releaseLock();
        }
    }

    await port.close();
}

disconnectScaleButton.onclick = async () => {
    // User clicked a button to close the serial port.
    keepReadingScale.value = false;
    // Force reader.read() to resolve immediately and subsequently
    // call reader.releaseLock() in the loop example above.
    serialPortReader.cancel();
    await serialPortReaderClosedPromise;

    connectScaleButton.style.display = "initial";
    disconnectScaleButton.style.display = "none";
    adapterSelection.style.display = "initial";
}

// listen for disconnection and connection
navigator.serial.addEventListener("connect", (event) => {
    console.log('Device connected:', event);
  });
  
  navigator.serial.addEventListener("disconnect", (event) => {
    console.log('Device disconnected:', event);
  });

async function readFromDevice(device, endpoint) {
    // reads data from the device
    // we get the data byte by byte despite the buffer size of 64 byte
    const result = await device.transferIn(endpoint, 64);
    const decoder = new TextDecoder();
    const message = decoder.decode(result.data);
    return message
}

function createLogEntry(action, value) {
    return new Date().toISOString() + " " + action + ": " + value + "<br/>"
}

// ====================================
// General UI
// ====================================

clearButton.onclick = async () => {
    scannedCodes.value = "";
    log.innerHTML = "";
}

// ====================================
// Scanner integration
// ====================================


function initOnScan(){
            
    // for description see
    // see https://github.com/axenox/onscan.js/blob/master/README.md#options 
    //
    // IDEALLY, we would have that configurable (at least the minLength and avgTimeByChar)
    var options = {
        keyCodeMapper: keyCodeMapper,
        timeBeforeScanTest: 100, 
        avgTimeByChar: 50,
        minLength: 6, 
        suffixKeyCodes: [9,13],
        prefixKeyCodes: [], 
        scanButtonLongPressTime: 500, 
        stopPropagation: false, 
        preventDefault: false,
        reactToPaste: false,
        reactToKeyDown: true,
        singleScanQty: 1
    }

    // register callbacks (could also be done in the options directly, but this way it's easier to get the options configurable I guess)
    document.addEventListener('scan', addScannedText);
    document.addEventListener('scanError', logScanError);
   
    // Start the whole thing
    try {
        onScan.attachTo(document, options);
        console.log("onScan Started!");
    } catch(e) {
        // this is how to update settings in case of changed parameters
        onScan.setOptions(document, options);
        console.log("onScansettings changed!");
    }

    
}

// THE BEEF: Callback called whenever a successful scan happens
function addScannedText(e) {
    var scannedContent = e.detail.scanCode;
    console.log("Scanned code: ", scannedContent, e);
    log.innerHTML += createLogEntry("scanned", scannedContent);
    scannedCodes.value += scannedContent + "\n";
}

// His is called in case of unsucessful scan attempts.
//
// ATTENTION: While the output is very useful for debugging and tuning, 
// keep in mind that this is called with every manual keyboard entry!
function logScanError(oDebug) {
    console.error("Barcode Scanning failed: ", oDebug);
}


// This custom mapper is needed to get special characters handled
// see https://github.com/axenox/onscan.js/blob/master/README.md#decoding-key-codes
function keyCodeMapper(oEvent) {
    // Look for special keycodes or other event properties specific to
	// your scanner
    //console.log("char code: ", oEvent.which)
	var iCode = onScan._getNormalizedKeyNum(oEvent);
    if(iCode >= 186 && iCode <= 222) { 
        if (oEvent.key !== undefined && oEvent.key !== '') {
          return oEvent.key;
        }
    }
    // fall back to the default implementation
	return onScan.decodeKeyEvent(oEvent);
}

// init on load
document.addEventListener("DOMContentLoaded", initOnScan);

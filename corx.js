/**
 * Created by zhuqizhong on 17-6-17.
 */
/**
 * Created by fx on 16-12-12.
 */
const EventEmitter = require('events');
const util = require('util');
const P = require('bluebird');
const Net = require('net');
const _ = require('lodash')
var Lock = require('lock');
var lock = Lock();
const CONN_STATE ={
    'idle':'idle',
    'connecting':'connecting',
    'connected':'connected',
    'error_waiting':'error_waiting',
    'deleted':'deleted'
}
class Parser extends  EventEmitter{
    constructor(timeout,onResult){
        super();
        this.timeout = timeout || 2000;
        this.timeHandler = null;
        this.onResult = onResult;
    }
    init(){
        if(this.timeHandler){
            clearTimeout(this.timeHandler);

        }
        this.timeHandler = setTimeout(function(){
            this.emit('end')
        }.bind(this),this.timeout||2000);

    }
    clearTimer(){
        if(this.timeHandler){
            clearTimeout(this.timeHandler);
            this.timeHandler = null;
        }
    }
    onChar(){

    }
}

//写入回应
class WriteRespParser extends Parser{

    constructor(timeout,onResult){
        super(timeout,onResult);
        this.READ_STATE = {
            WAIT_O:0,
            WAIT_K:1,
            WAIT_M:2
        }


    }
    init(){
        Parser.prototype.init.call(this);
        this.cur_state = this.READ_STATE.WAIT_O;
    }
    onChar(inChar){
        inChar = String.fromCharCode(parseInt(inChar)).toLowerCase();
        switch(this.cur_state){
            case this.READ_STATE.WAIT_O:
                if(inChar === 'o'){
                    this.cur_state = this.READ_STATE.WAIT_K
                }
                break;
            case this.READ_STATE.WAIT_K:
                if(inChar === 'k'){
                    this.cur_state = this.READ_STATE.WAIT_M
                }
                break;
            case this.READ_STATE.WAIT_M:
                if(inChar === '!'){
                    this.clearTimer();
                    this.emit('end');
                    this.cur_state = this.READ_STATE.WAIT_O
                }
                break;
        }
    }
}

//开关量或是继电器读取回应
class ReadRespParser extends Parser{

    constructor(timeout,onResult){
        super(timeout,onResult);
        this.READ_STATE = {
            WAIT_H1:0,
            WAIT_H2:1,
            WAIT_R:2,
            WAIT_ADDR:3,
            WAIT_S1:4,
            WAIT_S0:5,
            WAIT_END:6,
            WAIT_CS1:7,
            WAIT_CS2:8,
        }

    }
    init(){
        Parser.prototype.init.call(this);
        this.cur_state = this.READ_STATE.WAIT_H1;
        this.frame = {};
    }
    onChar(inChar){
        inChar = parseInt(inChar);
        switch(this.cur_state){
            case this.READ_STATE.WAIT_H1:
                if(inChar === 0xAA || inChar === 0xEE){
                    this.cur_state = this.READ_STATE.WAIT_H2
                }
                break;
            case this.READ_STATE.WAIT_H2:
                if(inChar === 0xBB || inChar === 0xFF){
                    this.cur_state = this.READ_STATE.WAIT_R
                }
                break;
            case this.READ_STATE.WAIT_R:
                this.frame.R = inChar;
                this.cs1 = inChar;
                this.cur_state = this.READ_STATE.WAIT_ADDR;
                break;
            case this.READ_STATE.WAIT_ADDR:
                this.frame.addr = inChar;
                this.cs1 += inChar;
                this.cur_state = this.READ_STATE.WAIT_S1;
                break;
            case this.READ_STATE.WAIT_S1:
                this.frame.status = [inChar];
                this.cs1 += inChar;
                this.cur_state = this.READ_STATE.WAIT_S0
                break;
            case this.READ_STATE.WAIT_S0:
                this.frame.status.unshift(inChar);
                this.cs1 += inChar;
                this.cur_state = this.READ_STATE.WAIT_END;
                break;
            case this.READ_STATE.WAIT_END:
                if(inChar === 0x0D){
                    this.cs1 += inChar;
                    this.cur_state = this.READ_STATE.WAIT_CS1
                }
                break;
            case this.READ_STATE.WAIT_CS1:
                this.clearTimer();
                if(inChar === (this.cs1 & 0xFF)){
                    this.cur_state = this.READ_STATE.WAIT_H1;
                    P.resolve().then(()=>{
                        if(this.onResult) {
                            return this.onResult(this.frame);
                        }
                    }).finally(()=>{
                        this.emit('end');
                    })
                }else{
                    this.emit('end');
                }
                this.cur_state = this.READ_STATE.WAIT_H1
                break;
            case this.READ_STATE.WAIT_CS2:

                if(inChar === ((this.cs1+this.cs1) & 0xFF)){



                    this.cur_state = this.READ_STATE.WAIT_H1
                }else{
                    this.emit('end');
                }
                break;

        }
    }
}

class CorxGate extends  EventEmitter{

    constructor(mac_id){
        super();
        this.connected = false;
        this.error_time = 0;
        this.cur_state = CONN_STATE.idle;
        this.client = new Net.Socket();
        this.mac_id = mac_id;
// 为客户端添加“data”事件处理函数
// data是服务器发回的数据
        this.client.on('data', (data) =>{

           // console.log('DATA: ' + JSON.stringify(data));
            // 完全关闭连接

            if(this.readDataParser){
                for(let i = 0; i <  data.length; i++)
                    this.readDataParser.onChar(data[i]);
            }

        });

        this.client.on('connect',()=>{
            this.enterState(CONN_STATE.connected)
        })
// 为客户端添加“close”事件处理函数
        this.client.on('close', function() {
            console.log('Connection closed');
        });

        this.client.on('error',(error)=>{
            console.error('error in working:',error.message || error);
            this.enterState(CONN_STATE.error_waiting);
        });
        this.client.on('timeout',()=>{
            this.enterState(CONN_STATE.error_waiting);
        });
        this.client.setTimeout(2000);
        this.in_value = [];
        this.out_target = [];
        this.out_value=[];
        this.callHandler = null;
    }
    enterState(newState){
        this.cur_state = newState;
        switch(newState){
            case CONN_STATE.idle:
                if(this.timeHandler){
                    clearTimeout(this.timeHandler);
                    this.timeHandler = null;
                }
                this.timeHandler = setTimeout(()=>{
                    this.timeHandler = null;
                    this.enterState(CONN_STATE.connecting);
                },500);
                break;
            case CONN_STATE.connecting:
                if(this.ip){
                    this.client.connect(this.port,this.ip);
                }else{
                    if(this.timeHandler){
                        clearTimeout(this.timeHandler);
                        this.timeHandler = null;
                    }
                    this.timeHandler = setTimeout(()=>{
                        this.timeHandler = null;
                        this.enterState(CONN_STATE.error_waiting);
                    },2000);
                }

                break;
            case CONN_STATE.connected:
                console.log(this.mac_id+':connected,ip:'+this.ip)
                this.error_time = 0;
                break;
            case CONN_STATE.error_waiting:


                if(this.error_time === 0){

                    try{
                        this.client.end();
                    }catch(e){
                        console.error('error in disconnect:',e);
                    }

                }
                this.error_time++;

                if(this.timeHandler){
                    clearTimeout(this.timeHandler);
                    this.timeHandler = null;
                }
                this.timeHandler = setTimeout(()=>{
                    this.timeHandler = null;
                    this.enterState(CONN_STATE.connecting);
                },3000);
                if(this.error_time > 10){
                    this.error_time = 0;

                    this.emit('error');
                }
                break;

            case CONN_STATE.deleted:
                try{
                    this.client.end();
                }catch(e){
                    console.error('error in disconnect:',e);
                }
                if(this.timeHandler){
                    clearTimeout(this.timeHandler);
                    this.timeHandler = null;
                }
                break;
        }

    }

    init(ip,inport_cnt,outport_cnt){
        //创建一个连接

        this.in = inport_cnt;
        this.out = outport_cnt;
        if(this.ip !== ip){
            this.ip = ip;
            this.port = 50000;
            if(this.client && this.client.destroy){
                this.client.destroy();
                this.enterState(CONN_STATE.error_waiting);
            }else{
                this.enterState(CONN_STATE.connecting);
            }


        }


    }


    writeWq(wq,values){
        return this.writeBQ(wq,values);
    }

    readWq(wq_map){
        return this.readBQ(wq_map)
    }

    readBI(biMap){
        let parser = new  ReadRespParser(2000,(frame)=>{
            let result = frame.status[0] + (frame.status[1]<<8);
            for(let i = 0; i < 16;i++){
                this.in_value[i] = (result & (0x01 << i)) ?true:false;
            }
        });
        let data = this.buildFrame(0xc0,0x01,[0,0,0x0d]);
        return this.writeAndWaitResult(data,parser).then(()=>{
            let result = [];
            for(let i = biMap.start;i<=biMap.end;i++){
                result.push(this.in_value[i]);
            }
            return result;
        })
    }
    writeBQ(biMap,values){
        let parser = new  WriteRespParser();
        let write_value = 0x00;
        for(let i = 0; i++;i<16){
            write_value |= (this.out_value[i]?(0x01 << i):0);
        }
        let write_mask = 0;
        for(let i = biMap.start;i<=biMap.end;i++){
            write_mask |= (0x01 << i);
            //对应的位先置0
            write_value &= ~(0x01 << i);
            if(values[i]){
                //对应的位置1
                write_value |= (0x01 << i);
            }
        }
        let data = this.buildFrame(0xa1,0x01,[(write_value>>8),write_value&0xFF,(write_mask>>8),write_mask&0xFF]);
        return this.writeAndWaitResult(data,parser).then(()=>{
            let result = [];

        });
    }
    readBQ(biMap){
        let parser = new  ReadRespParser(2000,(frame)=>{
            let result = frame.status[0] + (frame.status[1]<<8);
            for(let i = 0; i < 16;i++){
                this.out_value[i] = (result & (0x01 << i)) ?true:false;
            }
        });
        let data = this.buildFrame(0xB0,0x01,[0,0,0x0d]);
        return this.writeAndWaitResult(data,parser).then(()=>{
            let result = [];
            for(let i = biMap.start;i<=biMap.end;i++) {
                result.push(this.out_value[i]);
            }
            return result;
        });
    }

    writeBP(biMap,values){
        let parser = new  WriteRespParser();
        let write_value = 0x00;
        for(let i = 0; i++;i<16){
            write_value |= (this.out_value[i]?(0x01 << i):0);
        }
        let write_mask = 0;
        for(let i = biMap.start;i<=biMap.end;i++){
            write_mask |= (0x01 << i);
            //对应的位先置0
            write_value &= ~(0x01 << i);
            if(values[i]){
                //对应的位置1
                write_value |= (0x01 << i);
            }
        }
        let data = this.buildFrame(0x33,0x01,[(write_value>>8),write_value&0xFF,(write_mask>>8),write_mask&0xFF]);
        return this.writeAndWaitResult(data,parser).then(()=>{
            let result = [];

        });
    }


    //////////////内部使用的函数 ///////////////

    buildFrame(cmd,addr,data){
        let frame = [0xcc,0xdd];
        let cs1=0,cs2=0;
        cs1=cmd+addr;
        frame.push(cmd);
        frame.push(addr);
        frame = frame.concat(data);
        _.each(data,(item)=>{
            cs1+=item;
        });
        cs1 &= 0xFF;
        cs2 = (cs1+cs1)&0xFF;
        frame.push(cs1);
        frame.push(cs2);
        return frame;

    }
    writeAndWaitResult(sendData,dataparser){
        if(this.cur_state === CONN_STATE.connected){
            return new P((resolve,reject)=>{
                lock(this.ip+"_read",(release)=>{
                    dataparser.init();
                    this.readDataParser = dataparser;
                    this.client.write(new Buffer(sendData));
                    dataparser.on('end',()=>{
                        this.readDataParser = null;
                        release(function(){
                            resolve();
                        })();
                    })
                })
            })

        }else{
            return P.reject(`unconnected device ${this.mac_id}`);
        }

    }
}

module.exports  =  CorxGate;